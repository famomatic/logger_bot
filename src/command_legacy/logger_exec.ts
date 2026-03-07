import { spawn as spawnChildProcess } from 'node:child_process';
import nodeProcess from 'node:process';

import { spawn as spawnPty } from 'node-pty';

import { config } from '../config/config.js';
import { defaultText, getMessageLocale, t } from '../i18n/index.js';
import { logger } from '../utils/logger.js';

import type { LegacyCommand } from '../types/commands.js';
import type { SupportedLocale } from '../types/i18n.js';
import type { Message } from 'discord.js';
import type { IPty } from 'node-pty';

const MAX_BLOCK_LENGTH = 1800;
const PASSWORD_PROMPT_REGEX = /(password[^:\n]{0,64}:|sudo:)/i;

interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
}

function splitAtFirstWhitespace(input: string): { head: string; tail: string | null } {
    const match = /\s/.exec(input);
    if (!match) {
        return { head: input, tail: null };
    }
    const index = match.index;
    return { head: input.slice(0, index), tail: input.slice(index + 1).trimStart() };
}

function formatForCodeBlock(text: string): string {
    if (!text) {
        return '(no output)';
    }
    if (text.length <= MAX_BLOCK_LENGTH) {
        return text;
    }
    return `${text.slice(0, MAX_BLOCK_LENGTH - 20)}\n... (truncated)`;
}

function maskSensitive(text: string, secrets: string[]): string {
    if (!text) {
        return text;
    }

    let masked = text;

    for (const secret of secrets) {
        if (!secret) {
            continue;
        }

        const candidates = new Set<string>([secret]);
        const trimmed = secret.trim();
        if (trimmed && trimmed !== secret) {
            candidates.add(trimmed);
        }

        for (const candidate of candidates) {
            if (!candidate) {
                continue;
            }
            masked = masked.split(candidate).join('********');
        }
    }

    return masked;
}

function parseDurationToMs(value: string): number | null {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
        return null;
    }

    let unit: 'ms' | 's' | 'm' | 'h' = 's';
    let numericPart = trimmed;

    for (const candidate of ['ms', 's', 'm', 'h'] as const) {
        if (trimmed.endsWith(candidate)) {
            unit = candidate;
            numericPart = trimmed.slice(0, -candidate.length);
            break;
        }
    }

    const amount = Number(numericPart);
    if (!Number.isFinite(amount) || numericPart.includes(' ')) {
        return null;
    }

    const multiplier = unit === 'ms' ? 1 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 1_000;

    return Math.round(amount * multiplier);
}

function extractTimeoutOption(
    payload: string,
    defaultTimeoutMs?: number,
): { command: string; timeoutMs?: number } {
    let working = payload.trim();
    let timeoutMs = defaultTimeoutMs;

    const timeoutMatch = /^--timeout(?:=(\S+)|\s+(\S+))(?:\s+|$)/i.exec(working);
    if (timeoutMatch) {
        const timeoutValue = timeoutMatch[1] ? timeoutMatch[1] : timeoutMatch[2];
        if (!timeoutValue) {
            throw new Error('exec.timeoutValueRequired');
        }
        const parsed = parseDurationToMs(timeoutValue);
        if (parsed === null || parsed <= 0) {
            throw new Error('exec.timeoutInvalid');
        }
        timeoutMs = parsed;
        working = working.slice(timeoutMatch[0].length).trimStart();
    }

    return { command: working, timeoutMs };
}

function formatTimeout(locale: SupportedLocale, timeoutMs?: number): string | null {
    if (!timeoutMs || timeoutMs <= 0) {
        return null;
    }

    if (timeoutMs % 60000 === 0) {
        return t(locale, 'exec.minute', { value: timeoutMs / 60000 });
    }
    if (timeoutMs % 1000 === 0) {
        return t(locale, 'exec.second', { value: timeoutMs / 1000 });
    }
    return `${timeoutMs}ms`;
}

async function fetchSudoPasswordFromCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            const child = spawnChildProcess('bash', ['-lc', command], {
                env: nodeProcess.env,
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(
                        new Error(
                            stderr.trim() ||
                                stdout.trim() ||
                                defaultText('exec.sudoPasswordFetchFailed'),
                        ),
                    );
                }
            });

            child.on('error', reject);
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

async function getSudoPassword(): Promise<string | undefined> {
    if (config.sudoPassword) {
        return config.sudoPassword;
    }
    if (config.sudoPasswordCommand) {
        const password = await fetchSudoPasswordFromCommand(config.sudoPasswordCommand);
        return password || undefined;
    }
    return undefined;
}

async function runPtyProcess(
    program: string,
    args: string[],
    options: {
        env?: NodeJS.ProcessEnv;
        timeoutMs?: number;
        sudoPassword?: string;
        watchForSudo?: boolean;
    },
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let timer: NodeJS.Timeout | undefined;
        let resolved = false;

        let pty: IPty;
        try {
            pty = spawnPty(program, args, {
                name: 'xterm-color',
                cols: 200,
                rows: 30,
                env: options.env ?? nodeProcess.env,
            });
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
        }

        const finalize = (result: CommandResult) => {
            if (resolved) {
                return;
            }
            resolved = true;
            if (timer) {
                clearTimeout(timer);
            }
            resolve(result);
        };

        if (options.timeoutMs && options.timeoutMs > 0) {
            timer = setTimeout(() => {
                timedOut = true;
                try {
                    pty.kill();
                } catch {
                    // ignore kill errors
                }
            }, options.timeoutMs);
        }

        pty.onData((data: string) => {
            stdout += data;

            if (options.watchForSudo && /sudo:/i.test(data)) {
                stderr += data;
            }

            if (options.watchForSudo && options.sudoPassword && PASSWORD_PROMPT_REGEX.test(data)) {
                pty.write(`${options.sudoPassword}\r`);
            }
        });

        pty.onExit(({ exitCode }: { exitCode: number | null }) => {
            if (!stderr && exitCode !== null && exitCode !== 0 && stdout) {
                stderr = stdout;
            }
            finalize({ stdout, stderr, exitCode, timedOut });
        });
    });
}

async function ensureSudoTimestamp(sudoPassword: string, timeoutMs?: number): Promise<void> {
    const result = await runPtyProcess('sudo', ['-Sv'], {
        timeoutMs,
        sudoPassword,
        watchForSudo: true,
    });

    if (result.timedOut) {
        throw new Error('exec.sudoCheckTimeout');
    }
    if (result.exitCode !== 0) {
        throw new Error('exec.sudoRefreshFailed');
    }
}

async function runBashCommand(
    rawCommand: string,
    options: { timeoutMs?: number; sudoPassword?: string },
): Promise<CommandResult> {
    let command = rawCommand.trim();
    const containsSudo = /\bsudo\b/.test(command);

    if (containsSudo) {
        if (!options.sudoPassword) {
            throw new Error('exec.sudoConfigRequired');
        }
        command = command.replace(/\bsudo\b(?![^\n\r]*-S)/g, 'sudo -S');
        await ensureSudoTimestamp(options.sudoPassword, options.timeoutMs);
    }

    return runPtyProcess('bash', ['-lc', command], {
        env: nodeProcess.env,
        timeoutMs: options.timeoutMs,
        sudoPassword: containsSudo ? options.sudoPassword : undefined,
        watchForSudo: containsSudo,
    });
}

async function runPsqlCommand(
    query: string,
    options: { timeoutMs?: number },
): Promise<CommandResult> {
    return runPtyProcess(
        'psql',
        [
            '-h',
            config.dbHost,
            '-p',
            String(config.dbPort),
            '-U',
            config.dbUser,
            '-d',
            config.dbName,
            '-c',
            query,
        ],
        {
            env: {
                ...nodeProcess.env,
                PGPASSWORD: config.dbPassword,
            },
            timeoutMs: options.timeoutMs,
        },
    );
}

const command: LegacyCommand = {
    name: 'exec',
    async execute(message: Message) {
        const locale = getMessageLocale(message);
        if (!config.superAdminIds.includes(message.author.id)) {
            await message.reply(t(locale, 'exec.dev3Only'));
            return;
        }

        const trimmed = message.content.trim();
        const firstSplit = splitAtFirstWhitespace(trimmed);
        if (!firstSplit.tail) {
            await message.reply(t(locale, 'exec.usage'));
            return;
        }

        const secondSplit = splitAtFirstWhitespace(firstSplit.tail);
        if (!secondSplit.tail) {
            await message.reply(t(locale, 'exec.usage'));
            return;
        }

        const thirdSplit = splitAtFirstWhitespace(secondSplit.tail);
        if (!thirdSplit.tail) {
            await message.reply(t(locale, 'exec.usage'));
            return;
        }

        const mode = thirdSplit.head;
        const payload = thirdSplit.tail;

        if (!payload) {
            await message.reply(t(locale, 'exec.promptCommand'));
            return;
        }

        const reply = await message.reply(t(locale, 'exec.running'));

        let timeoutMs: number | undefined;
        let commandPayload: string;

        try {
            const timeoutResult = extractTimeoutOption(payload, config.execCommandTimeoutMs);
            commandPayload = timeoutResult.command;
            timeoutMs = timeoutResult.timeoutMs;
        } catch (optionError) {
            await reply.edit(
                optionError instanceof Error ? t(locale, optionError.message) : String(optionError),
            );
            return;
        }

        if (!commandPayload) {
            await reply.edit(t(locale, 'exec.promptCommand'));
            return;
        }

        const secrets: string[] = [];

        try {
            let result: CommandResult;
            let sudoPassword: string | undefined;

            if (mode === 'bash') {
                if (/\bsudo\b/.test(commandPayload)) {
                    sudoPassword = await getSudoPassword();
                    if (!sudoPassword) {
                        await reply.edit(t(locale, 'exec.sudoConfigRequired'));
                        return;
                    }
                    secrets.push(sudoPassword);
                }

                result = await runBashCommand(commandPayload, { timeoutMs, sudoPassword });
            } else if (mode === 'psql') {
                result = await runPsqlCommand(commandPayload, { timeoutMs });
            } else {
                await reply.edit(t(locale, 'exec.unsupportedMode'));
                return;
            }

            const timeoutLabel = formatTimeout(locale, timeoutMs);
            const trimmedStdout = maskSensitive(result.stdout.trim(), secrets);
            const trimmedStderr = maskSensitive(result.stderr.trim(), secrets);

            const stdoutBlock = formatForCodeBlock(trimmedStdout);
            const stderrBlock = formatForCodeBlock(trimmedStderr);

            let response =
                `${t(locale, 'exec.mode', { mode })}\n` +
                `${t(locale, 'exec.exitCode', { code: result.exitCode ?? t(locale, 'exec.unknown') })}`;
            if (timeoutLabel) {
                response += `\n${t(locale, 'exec.timeout', { value: timeoutLabel })}`;
            }
            if (result.timedOut) {
                response += `\n${t(locale, 'exec.timedOut')}`;
            }
            if (trimmedStdout) {
                response += `\n\n**STDOUT**\n\u0060\u0060\u0060\n${stdoutBlock}\n\u0060\u0060\u0060`;
            }
            if (trimmedStderr) {
                response += `\n\n**STDERR**\n\u0060\u0060\u0060\n${stderrBlock}\n\u0060\u0060\u0060`;
            }
            if (!trimmedStdout && !trimmedStderr) {
                response += `\n\n${t(locale, 'exec.noOutput')}`;
            }

            response = maskSensitive(response, secrets);

            if (response.length >= 1900) {
                response = `${response.slice(0, 1890)}\n...`;
            }

            await reply.edit(response);

            logger.info(
                `Legacy exec command executed by ${message.author.tag} (${message.author.id}) in mode ${mode}`,
            );
        } catch (error) {
            const err = error as Error;
            const translatedMessage = err.message.startsWith('exec.')
                ? t(locale, err.message)
                : err.message
                  ? String(err.message)
                  : String(error);
            const messageToSend = maskSensitive(translatedMessage, secrets);
            const stackToLog = err.stack ? maskSensitive(String(err.stack), secrets) : undefined;

            if (stackToLog) {
                const sanitizedError = new Error(messageToSend);
                sanitizedError.stack = stackToLog;
                logger.error('Failed to execute legacy exec command:', sanitizedError);
            } else {
                logger.error('Failed to execute legacy exec command:', messageToSend);
            }

            await reply.edit(t(locale, 'exec.failed', { error: messageToSend }));
        }
    },
};

/**
 * 레거시 커맨드 모듈 계약(`export { command }`)입니다.
 */
export { command };
