import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';

export default defineConfig(
    // 1. 무시 경로
    {
        ignores: ['dist/**', 'node_modules/**', 'eslint.config.js', 'src/types/*.d.ts'],
    },

    // 2. 기본 추천 설정
    eslint.configs.recommended,

    // 3. TypeScript 및 주석 제어 설정
    {
        files: ['scripts/**/*.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
            },
        },
    },

    // 4. TypeScript 및 주석 제어 설정
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
            },
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'error',
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
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
                    message:
                        'Avoid double assertion via `unknown`: `(x as unknown) as T`. Prefer runtime checks/type guards, or a single justified assertion.',
                },
                {
                    selector:
                        "CallExpression[callee.type='MemberExpression'][callee.property.name='join'][arguments.length=1][arguments.0.type='Literal'][arguments.0.value='\\\\n']",
                    message:
                        "Avoid `join('\\\\n')`. Use a real newline join (`join('\\n')`) or direct template/newline handling.",
                },
            ],
        },
    },

    // 6. Prettier 설정
    eslintConfigPrettier,
);
