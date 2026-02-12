import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import eslintComments from 'eslint-plugin-eslint-comments';

export default defineConfig(
    // 1. 무시 경로
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'scripts/**',
            'eslint.config.js',
            'src/types/*.d.ts',
        ],
    },

    // 2. 기본 추천 설정
    eslint.configs.recommended,

    // 3. TypeScript 및 주석 제어 설정
    {
        files: ['**/*.ts', '**/*.tsx'],
        extends: [
            ...tseslint.configs.recommendedTypeChecked,
            ...tseslint.configs.stylisticTypeChecked,
        ],
        plugins: {
            'eslint-comments': eslintComments,
        },
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
        rules: {
            '@typescript-eslint/no-var-requires': 'error',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/ban-ts-comment': [
                'error',
                {
                    'ts-ignore': true,
                    'ts-nocheck': true,
                    'ts-check': false,
                    'ts-expect-error': true,
                },
            ],
            'eslint-comments/no-use': 'error',
        },
    },

    // 6. Prettier 설정
    eslintConfigPrettier,
);
