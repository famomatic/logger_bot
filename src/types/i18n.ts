export type Primitive = string | number | boolean;

export type SupportedLocale = string;

export interface LocaleMetadata {
    code: SupportedLocale;
    compatibleLocales: string[];
    fallback?: boolean;
}

export interface LocaleDefinition {
    metadata: LocaleMetadata;
    messages: Record<string, unknown>;
}
