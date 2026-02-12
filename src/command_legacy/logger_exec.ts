import { Message } from 'discord.js';
import { spawn as spawnChildProcess } from 'child_process';
import { spawn as spawnPty } from 'node-pty';
import type { IPty } from 'node-pty';
import { LegacyCommand } from '../utils/loadLegacyCommands.js';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

const MAX_BLOCK_LENGTH = 1800;
const PASSWORD_PROMPT_REGEX = /(password[^:]*:|sudo:)/i;

interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
}

function splitAtFirstWhitespace(input: string): { head: string; tail: string | null } {
    const match = /\s/.exec(input);
    if (match?.index === undefined) {
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
    const trimmed = value.trim();
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(trimmed);
    if (!match) {
        return null;
    }

    const amount = Number(match[1]);
    if (Number.isNaN(amount)) {
        return null;
    }

    const unit = (match[2] ?? 's').toLowerCase();
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
        const timeoutValue = timeoutMatch[1] ?? timeoutMatch[2];
        if (!timeoutValue) {
            throw new Error('타임아웃 값이 필요합니다. 예: --timeout=30s');
        }
        const parsed = parseDurationToMs(timeoutValue);
        if (parsed === null || parsed <= 0) {
            throw new Error('타임아웃 형식이 올바르지 않습니다. (예: 30s, 5m, 10000ms)');
        }
        timeoutMs = parsed;
        working = working.slice(timeoutMatch[0].length).trimStart();
    }

    return { command: working, timeoutMs };
}

function formatTimeout(timeoutMs?: number): string | null {
    if (!timeoutMs || timeoutMs <= 0) {
        return null;
    }

    if (timeoutMs % 60000 === 0) {
        return `${timeoutMs / 60000}분`;
    }
    if (timeoutMs % 1000 === 0) {
        return `${timeoutMs / 1000}초`;
    }
    return `${timeoutMs}ms`;
}

async function fetchSudoPasswordFromCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            const child = spawnChildProcess('bash', ['-lc', command], {
                env: process.env,
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
                                'sudo 비밀번호를 가져오는 데 실패했습니다.',
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
                env: options.env ?? process.env,
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
        throw new Error('sudo 자격 증명 확인이 타임아웃되었습니다.');
    }
    if (result.exitCode !== 0) {
        throw new Error('sudo 자격 증명을 갱신하지 못했습니다.');
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
            throw new Error(
                'sudo 명령을 실행하려면 SUDO_PASSWORD 또는 SUDO_PASSWORD_COMMAND 설정이 필요합니다.',
            );
        }
        command = command.replace(/\bsudo\b(?![^\n\r]*-S)/g, 'sudo -S');
        await ensureSudoTimestamp(options.sudoPassword, options.timeoutMs);
    }

    return runPtyProcess('bash', ['-lc', command], {
        env: process.env,
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
                ...process.env,
                PGPASSWORD: config.dbPassword,
            },
            timeoutMs: options.timeoutMs,
        },
    );
}

const command: LegacyCommand = {
    name: 'exec',
    async execute(message: Message) {
        const devLevel = config.getDevLevel(message.author.id);
        if (devLevel < 3) {
            await message.reply('이 명령어는 개발자 레벨 3 이상만 사용할 수 있습니다.');
            return;
        }

        const trimmed = message.content.trim();
        const firstSplit = splitAtFirstWhitespace(trimmed);
        if (!firstSplit.tail) {
            await message.reply('사용법: logger exec <bash|psql> <command>');
            return;
        }

        const secondSplit = splitAtFirstWhitespace(firstSplit.tail);
        if (!secondSplit.tail) {
            await message.reply('사용법: logger exec <bash|psql> <command>');
            return;
        }

        const thirdSplit = splitAtFirstWhitespace(secondSplit.tail);
        if (!thirdSplit.tail) {
            await message.reply('사용법: logger exec <bash|psql> <command>');
            return;
        }

        const mode = thirdSplit.head;
        const payload = thirdSplit.tail;

        if (!payload) {
            await message.reply('실행할 명령어 또는 쿼리를 입력해주세요.');
            return;
        }

        const reply = await message.reply('⏳ 명령을 실행 중입니다...');

        let timeoutMs = config.execCommandTimeoutMs;
        let commandPayload = payload;

        try {
            const timeoutResult = extractTimeoutOption(payload, config.execCommandTimeoutMs);
            commandPayload = timeoutResult.command;
            timeoutMs = timeoutResult.timeoutMs;
        } catch (optionError) {
            await reply.edit(
                String(optionError instanceof Error ? optionError.message : optionError),
            );
            return;
        }

        if (!commandPayload) {
            await reply.edit('실행할 명령어 또는 쿼리를 입력해주세요.');
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
                        await reply.edit(
                            'sudo 명령을 실행하려면 SUDO_PASSWORD 또는 SUDO_PASSWORD_COMMAND가 필요합니다.',
                        );
                        return;
                    }
                    secrets.push(sudoPassword);
                }

                result = await runBashCommand(commandPayload, { timeoutMs, sudoPassword });
            } else if (mode === 'psql') {
                result = await runPsqlCommand(commandPayload, { timeoutMs });
            } else {
                await reply.edit('지원하지 않는 모드입니다. 사용 가능 모드: bash, psql');
                return;
            }

            const timeoutLabel = formatTimeout(timeoutMs);
            const trimmedStdout = maskSensitive(result.stdout.trim(), secrets);
            const trimmedStderr = maskSensitive(result.stderr.trim(), secrets);

            const stdoutBlock = formatForCodeBlock(trimmedStdout);
            const stderrBlock = formatForCodeBlock(trimmedStderr);

            let response = `**모드:** ${mode}\n**종료 코드:** ${result.exitCode ?? '알 수 없음'}`;
            if (timeoutLabel) {
                response += `\n**타임아웃:** ${timeoutLabel}`;
            }
            if (result.timedOut) {
                response += '\n⚠️ 명령이 타임아웃으로 종료되었습니다.';
            }
            if (trimmedStdout) {
                response += `\n\n**STDOUT**\n\u0060\u0060\u0060\n${stdoutBlock}\n\u0060\u0060\u0060`;
            }
            if (trimmedStderr) {
                response += `\n\n**STDERR**\n\u0060\u0060\u0060\n${stderrBlock}\n\u0060\u0060\u0060`;
            }
            if (!trimmedStdout && !trimmedStderr) {
                response += '\n\n출력 없음';
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
            const messageToSend = maskSensitive(
                err?.message ? String(err.message) : String(error),
                secrets,
            );
            const stackToLog = err?.stack ? maskSensitive(String(err.stack), secrets) : undefined;

            if (stackToLog) {
                const sanitizedError = new Error(messageToSend);
                sanitizedError.stack = stackToLog;
                logger.error('Failed to execute legacy exec command:', sanitizedError);
            } else {
                logger.error('Failed to execute legacy exec command:', messageToSend);
            }

            await reply.edit(`❌ 실행 중 오류가 발생했습니다: ${messageToSend}`);
        }
    },
};

export { command };
