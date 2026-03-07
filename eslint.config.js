import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import importPlugin from 'eslint-plugin-import';
import promisePlugin from 'eslint-plugin-promise';
import unicornPlugin from 'eslint-plugin-unicorn';
import securityPlugin from 'eslint-plugin-security';
import regexpPlugin from 'eslint-plugin-regexp';
import nPlugin from 'eslint-plugin-n';

const localRules = {
    rules: {
        'no-import-reexport-hack': {
            meta: {
                type: 'problem',
                docs: {
                    description:
                        'Disallow exporting imported value bindings or redeclaring imported names in exports, while allowing type-only re-exports.',
                },
                schema: [],
                messages: {
                    reexportImported:
                        "Do not export imported binding '{{name}}'. Re-export from the source module directly, or create a real local declaration.",
                    redeclareImported:
                        "Do not declare export '{{name}}' with the same name as an imported binding.",
                    exportDefaultImported:
                        "Do not export default imported binding '{{name}}'. Re-export from the source module directly instead.",
                },
            },

            create(context) {
                const importedLocals = new Map();

                function addImportedLocal(name, node, source) {
                    importedLocals.set(name, { node, source });
                }

                function collectPatternNames(pattern, names = []) {
                    if (!pattern) return names;

                    switch (pattern.type) {
                        case 'Identifier':
                            names.push(pattern.name);
                            break;

                        case 'ObjectPattern':
                            for (const prop of pattern.properties) {
                                if (prop.type === 'Property') {
                                    collectPatternNames(prop.value, names);
                                } else if (prop.type === 'RestElement') {
                                    collectPatternNames(prop.argument, names);
                                }
                            }
                            break;

                        case 'ArrayPattern':
                            for (const element of pattern.elements) {
                                if (element) collectPatternNames(element, names);
                            }
                            break;

                        case 'RestElement':
                            collectPatternNames(pattern.argument, names);
                            break;

                        case 'AssignmentPattern':
                            collectPatternNames(pattern.left, names);
                            break;
                    }

                    return names;
                }

                function reportIfImportedIdentifier(node, name, messageId) {
                    if (!name || !importedLocals.has(name)) return;

                    context.report({
                        node,
                        messageId,
                        data: { name },
                    });
                }

                return {
                    ImportDeclaration(node) {
                        const source = node.source.value;

                        for (const specifier of node.specifiers) {
                            addImportedLocal(specifier.local.name, specifier, source);
                        }
                    },

                    ExportNamedDeclaration(node) {
                        if (node.exportKind === 'type') {
                            return;
                        }

                        for (const specifier of node.specifiers) {
                            if (specifier.exportKind === 'type') {
                                continue;
                            }

                            if (specifier.local?.type === 'Identifier') {
                                reportIfImportedIdentifier(
                                    specifier.local,
                                    specifier.local.name,
                                    'reexportImported',
                                );
                            }
                        }

                        const decl = node.declaration;
                        if (!decl) return;

                        if (
                            (decl.type === 'FunctionDeclaration' ||
                                decl.type === 'ClassDeclaration') &&
                            decl.id?.type === 'Identifier'
                        ) {
                            reportIfImportedIdentifier(decl.id, decl.id.name, 'redeclareImported');
                            return;
                        }

                        if (decl.type === 'VariableDeclaration') {
                            for (const declarator of decl.declarations) {
                                const names = collectPatternNames(declarator.id);
                                for (const name of names) {
                                    reportIfImportedIdentifier(
                                        declarator.id,
                                        name,
                                        'redeclareImported',
                                    );
                                }
                            }
                        }
                    },

                    ExportDefaultDeclaration(node) {
                        const decl = node.declaration;

                        if (decl.type === 'Identifier') {
                            reportIfImportedIdentifier(decl, decl.name, 'exportDefaultImported');
                            return;
                        }

                        if (
                            (decl.type === 'FunctionDeclaration' ||
                                decl.type === 'ClassDeclaration') &&
                            decl.id?.type === 'Identifier'
                        ) {
                            reportIfImportedIdentifier(decl.id, decl.id.name, 'redeclareImported');
                        }
                    },
                };
            },
        },
    },
};

const plugins = {
    'eslint-comments': eslintComments,
    import: importPlugin,
    promise: promisePlugin,
    unicorn: unicornPlugin,
    security: securityPlugin,
    regexp: regexpPlugin,
    n: nPlugin,
    local: localRules,
};

const baseLanguageOptions = {
    parser: tseslint.parser,
    parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
    },
    globals: {
        ...globals.node,
    },
};

const importResolverSettings = {
    'import/resolver': {
        node: true,
    },
};

const restrictedSyntax = {
    doubleAssertionViaUnknown: {
        selector:
            "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
        message:
            'Avoid double assertion via `unknown`: `(x as unknown) as T`. Prefer runtime checks/type guards, or a single justified assertion.',
    },
    defaultExport: {
        selector: 'ExportDefaultDeclaration',
        message: 'Default export is forbidden. Use named exports instead.',
    },
    deepRelativeImport: {
        selector: 'ImportDeclaration[source.value=/^(\\.\\.\\/){3,}/]',
        message:
            'Avoid deep relative imports with 3 or more `../`. Use an alias or restructure modules.',
    },
    directProcessEnv: {
        selector:
            ":matches(MemberExpression[object.type='Identifier'][object.name='process'][property.name='env'], MemberExpression[object.type='MemberExpression'][object.object.type='Identifier'][object.object.name='globalThis'][object.property.name='process'][property.name='env'])",
        message:
            'Do not access `process.env` directly. Read environment values through a validated config module.',
    },
    consoleLogCall: {
        selector:
            ":matches(CallExpression[callee.type='MemberExpression'][callee.property.name='log'][callee.object.type='Identifier'][callee.object.name='console'], CallExpression[callee.type='MemberExpression'][callee.property.name='log'][callee.object.type='MemberExpression'][callee.object.object.type='Identifier'][callee.object.object.name='globalThis'][callee.object.property.name='console'])",
        message:
            'Do not use console.log in application code. Route logs through the logger layer instead.',
    },
};

const syntaxPolicy = {
    app: [
        restrictedSyntax.doubleAssertionViaUnknown,
        restrictedSyntax.defaultExport,
        restrictedSyntax.deepRelativeImport,
        restrictedSyntax.directProcessEnv,
        restrictedSyntax.consoleLogCall,
    ],
    config: [restrictedSyntax.doubleAssertionViaUnknown, restrictedSyntax.deepRelativeImport],
    test: [restrictedSyntax.doubleAssertionViaUnknown, restrictedSyntax.deepRelativeImport],
};

const tsBaseRules = {
    'eslint-comments/disable-enable-pair': ['error', { allowWholeFile: false }],
    'eslint-comments/no-aggregating-enable': 'error',
    'eslint-comments/no-duplicate-disable': 'error',
    'eslint-comments/require-description': ['error', { ignore: [] }],
    '@typescript-eslint/no-require-imports': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-redeclare': 'error',
    'no-redeclare': 'off',

    '@typescript-eslint/ban-ts-comment': [
        'error',
        {
            'ts-ignore': true,
            'ts-nocheck': true,
            'ts-check': false,
            'ts-expect-error': true,
        },
    ],

    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',

    '@typescript-eslint/no-floating-promises': [
        'error',
        {
            ignoreVoid: false,
            ignoreIIFE: false,
        },
    ],
    '@typescript-eslint/require-await': 'error',
    '@typescript-eslint/no-misused-promises': [
        'error',
        {
            checksVoidReturn: {
                arguments: true,
                attributes: false,
            },
        },
    ],
    '@typescript-eslint/no-unnecessary-condition': 'error',
    '@typescript-eslint/consistent-type-imports': [
        'error',
        {
            prefer: 'type-imports',
            fixStyle: 'separate-type-imports',
        },
    ],
    '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
            allowNumber: true,
            allowBoolean: true,
            allowAny: false,
            allowNullish: false,
            allowRegExp: false,
        },
    ],

    'eslint-comments/no-use': 'error',

    'import/no-self-import': 'error',
    'import/no-duplicates': 'error',
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/order': [
        'error',
        {
            groups: [
                'builtin',
                'external',
                'internal',
                ['parent', 'sibling', 'index'],
                'object',
                'type',
            ],
            'newlines-between': 'always',
            alphabetize: {
                order: 'asc',
                caseInsensitive: true,
            },
        },
    ],

    'promise/catch-or-return': [
        'error',
        {
            allowFinally: true,
        },
    ],
    'promise/no-return-wrap': 'error',

    'unicorn/prefer-node-protocol': 'error',
    'unicorn/prevent-abbreviations': 'off',
    'unicorn/no-null': 'off',

    'security/detect-object-injection': 'off',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-unsafe-regex': 'warn',

    'regexp/no-dupe-characters-character-class': 'error',
    'regexp/no-empty-alternative': 'error',
    'regexp/no-obscure-range': 'error',
    'regexp/no-super-linear-backtracking': 'warn',
    'regexp/optimal-quantifier-concatenation': 'warn',

    'local/no-import-reexport-hack': 'error',
};

const appRules = {
    ...tsBaseRules,

    'no-restricted-syntax': ['error', ...syntaxPolicy.app],
};

const configRules = {
    ...tsBaseRules,

    '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
            allowExpressions: true,
            allowTypedFunctionExpressions: true,
        },
    ],

    'unicorn/no-array-for-each': 'warn',

    'n/no-process-exit': 'error',
    'n/prefer-global/process': 'error',
    'n/prefer-global/buffer': 'error',

    'no-restricted-syntax': ['error', ...syntaxPolicy.config],
};

const testRules = {
    ...tsBaseRules,

    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/require-await': 'off',

    'no-restricted-syntax': ['error', ...syntaxPolicy.test],
};

function makeTsBlock({ files, ignores = [], rules }) {
    return {
        files,
        ignores,
        extends: [
            ...tseslint.configs.recommendedTypeChecked,
            ...tseslint.configs.stylisticTypeChecked,
        ],
        plugins,
        languageOptions: baseLanguageOptions,
        settings: importResolverSettings,
        rules,
    };
}

export default defineConfig(
    {
        ignores: ['dist/**', 'build/**', 'coverage/**', 'node_modules/**', '**/*.d.ts'],
    },

    eslint.configs.recommended,

    {
        files: ['scripts/**/*.cjs'],
        plugins,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'n/no-process-exit': 'error',
            'n/prefer-global/process': 'error',
            'n/prefer-global/buffer': 'error',
        },
    },

    makeTsBlock({
        files: ['**/*.ts', '**/*.tsx'],
        ignores: [
            '**/config.ts',
            '**/*.config.ts',
            '**/config.*.ts',
            '**/env.ts',
            '**/*.env.ts',
            '**/env.*.ts',
            '**/*.test.ts',
            '**/*.spec.ts',
            '**/*.test.tsx',
            '**/*.spec.tsx',
            '**/__tests__/**',
        ],
        rules: appRules,
    }),

    makeTsBlock({
        files: [
            '**/config.ts',
            '**/*.config.ts',
            '**/config.*.ts',
            '**/env.ts',
            '**/*.env.ts',
            '**/env.*.ts',
        ],
        rules: configRules,
    }),

    makeTsBlock({
        files: [
            '**/*.test.ts',
            '**/*.spec.ts',
            '**/*.test.tsx',
            '**/*.spec.tsx',
            '**/__tests__/**/*.ts',
            '**/__tests__/**/*.tsx',
        ],
        rules: testRules,
    }),

    eslintConfigPrettier,
);
