import { Locale, type Message } from 'discord.js';
import enLocale from './locales/en.js';
import koLocale from './locales/ko.js';
import type { LocaleDefinition, Primitive, SupportedLocale } from '../types/i18n.js';
export type { SupportedLocale } from '../types/i18n.js';

const localeDefinitions: LocaleDefinition[] = [koLocale, enLocale];

const localesByCode = new Map<SupportedLocale, LocaleDefinition>();
const localeLookup = new Map<string, SupportedLocale>();

for (const definition of localeDefinitions) {
    localesByCode.set(definition.metadata.code, definition);

    localeLookup.set(definition.metadata.code.toLowerCase(), definition.metadata.code);
    for (const compatible of definition.metadata.compatibleLocales) {
        localeLookup.set(compatible.toLowerCase(), definition.metadata.code);
    }
}

const fallbackLocaleCode =
    localeDefinitions.find((item) => item.metadata.fallback)?.metadata.code ?? 'en';
const discordCommandLocales = new Set<string>(Object.values(Locale));

/**
 * 점(.) 경로 키를 따라 locale 메시지 딕셔너리에서 문자열 값을 조회합니다.
 */
function getByPath(dict: Record<string, unknown>, path: string): string | undefined {
    const value = path.split('.').reduce<unknown>((acc, segment) => {
        if (acc && typeof acc === 'object' && segment in (acc as Record<string, unknown>)) {
            return (acc as Record<string, unknown>)[segment];
        }
        return undefined;
    }, dict);

    return typeof value === 'string' ? value : undefined;
}

/**
 * Discord locale 문자열(예: `ko`, `ko-KR`)을 지원 로케일 코드로 매핑합니다.
 */
function findLocaleCode(rawLocale: string | null | undefined): SupportedLocale | undefined {
    if (!rawLocale) {
        return undefined;
    }

    const lowered = rawLocale.toLowerCase();
    const exact = localeLookup.get(lowered);
    if (exact) {
        return exact;
    }

    for (const [compatible, code] of localeLookup.entries()) {
        if (lowered.startsWith(`${compatible}-`)) {
            return code;
        }
    }

    return undefined;
}

/**
 * 입력 로케일을 지원 코드로 정규화하고, 매칭 실패 시 fallback 로케일을 반환합니다.
 */
export function resolveLocale(locale: string | null | undefined): SupportedLocale {
    return findLocaleCode(locale) ?? fallbackLocaleCode;
}

/**
 * 인터랙션에서 사용자/길드 로케일을 읽어 사용 가능한 로케일로 변환합니다.
 */
export function getInteractionLocale(interaction: {
    locale?: string | null;
    guildLocale?: string | null;
}): SupportedLocale {
    return resolveLocale(interaction.locale ?? interaction.guildLocale);
}

/**
 * 메시지의 길드 기본 로케일을 앱에서 지원하는 로케일 코드로 변환합니다.
 */
export function getMessageLocale(message: Pick<Message, 'guild'>): SupportedLocale {
    return resolveLocale(message.guild?.preferredLocale);
}

/**
 * 로케일 키를 템플릿 문자열로 변환하고 `{param}` 플레이스홀더를 치환합니다.
 */
export function t(
    locale: SupportedLocale,
    key: string,
    params: Record<string, Primitive> = {},
): string {
    const current = localesByCode.get(locale) ?? localesByCode.get(fallbackLocaleCode);
    const fallback = localesByCode.get(fallbackLocaleCode);

    const template =
        (current ? getByPath(current.messages, key) : undefined) ??
        (fallback ? getByPath(fallback.messages, key) : undefined) ??
        key;

    return template.replace(/\{(\w+)\}/g, (_, variable: string) => {
        const value = params[variable];
        return value === undefined ? `{${variable}}` : String(value);
    });
}

/**
 * fallback 로케일 기준으로 텍스트를 조회합니다.
 */
export function defaultText(key: string, params: Record<string, Primitive> = {}): string {
    return t(fallbackLocaleCode, key, params);
}

/**
 * slash command 등록용 locale map(`{ localeCode: text }`)을 생성합니다.
 */
export function localizations(key: string): Record<string, string> {
    const out: Record<string, string> = {};

    for (const definition of localeDefinitions) {
        const value = t(definition.metadata.code, key);
        for (const compatible of definition.metadata.compatibleLocales) {
            if (discordCommandLocales.has(compatible)) {
                out[compatible] = value;
            }
        }
    }

    return out;
}

/**
 * 현재 번들에 포함된 지원 로케일 코드 목록을 반환합니다.
 */
export function getSupportedLocaleCodes(): SupportedLocale[] {
    return Array.from(localesByCode.keys());
}
