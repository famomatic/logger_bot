export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonData | JsonValue[];

export interface JsonData {
    [key: string]: JsonValue | undefined;
}
