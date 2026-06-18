// ESLint 9 flat config — applies to all workspace packages.
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

// DB-touching @benkyou/core barrels: their index re-exports modules that import
// the `postgres` driver (via ../db). A client component value-importing one of
// these pulls the driver into the client bundle and breaks `next build` — a
// failure invisible to typecheck/vitest/`next dev`, only caught by a production
// build. Client components must import the pure leaf module (e.g.
// '@benkyou/core/items/pipeline-view') for runtime values, or use `import type`.
const DB_TOUCHING_BARRELS = new Set([
  '@benkyou/core/items',
  '@benkyou/core/settings',
  '@benkyou/core/sources',
  '@benkyou/core/search',
  '@benkyou/core/setup',
  '@benkyou/core/onboarding',
  '@benkyou/core/queue',
  '@benkyou/core/db',
]);

/** @type {import('eslint').Rule.RuleModule} */
const noClientDbBarrel = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow client components from value-importing DB-touching @benkyou/core barrels (bundles the postgres driver into the client).',
    },
    messages: {
      banned:
        "Client component value-imports '{{source}}', a DB-touching barrel — this pulls the postgres driver into the client bundle and breaks `next build`. Import the leaf module (e.g. '@benkyou/core/items/pipeline-view') for runtime values, or use `import type` for types only.",
    },
    schema: [],
  },
  create(context) {
    const isClient = context.sourceCode.ast.body.some(
      (n) => n.type === 'ExpressionStatement' && n.directive === 'use client',
    );
    if (!isClient) return {};
    return {
      ImportDeclaration(node) {
        if (!DB_TOUCHING_BARRELS.has(node.source.value)) return;
        if (node.importKind === 'type') return; // whole-statement `import type { … }`
        const allTypeOnly =
          node.specifiers.length > 0 &&
          node.specifiers.every((s) => s.type === 'ImportSpecifier' && s.importKind === 'type');
        if (!allTypeOnly) {
          context.report({ node, messageId: 'banned', data: { source: node.source.value } });
        }
      },
    };
  },
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/coverage/**',
      '**/pgdata/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Structured output must go through generateStructured(), which guarantees
      // the json_object prompt contract across providers. Importing generateObject
      // directly bypasses that floor and silently breaks on openai-family endpoints.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'ai',
              importNames: ['generateObject'],
              message:
                'Use generateStructured() from @benkyou/core (ai/structured.ts) instead — it guarantees the json_object prompt contract across providers.',
            },
          ],
        },
      ],
    },
  },
  {
    // The wrapper is the one place allowed to call the raw SDK.
    files: ['packages/core/src/ai/structured.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Client/server bundle boundary only matters in the Next app.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { benkyou: { rules: { 'no-client-db-barrel': noClientDbBarrel } } },
    rules: { 'benkyou/no-client-db-barrel': 'error' },
  },
];
