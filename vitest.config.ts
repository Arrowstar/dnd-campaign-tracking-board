import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: false,
  esbuild: {
    // Next.js keeps `jsx: preserve` for the app build; Vite's esbuild pipeline
    // needs to transform JSX itself (mentionSuggestion.test.ts imports .tsx).
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
