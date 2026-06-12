// ESLint 9 flat config — applies to all workspace packages.
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

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
];
