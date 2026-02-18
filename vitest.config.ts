import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'client/src/**/__tests__/**/*.test.ts',
      'server/src/**/__tests__/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'client/src/canvas/Geometry.ts',
        'client/src/canvas/HitTest.ts',
        'client/src/canvas/Camera.ts',
        'client/src/board/ObjectStore.ts',
        'server/src/ai/schema.ts',
        'server/src/ai/boardTools.ts',
        'server/src/routes/boards.ts',
        'server/src/auth.ts',
      ],
    },
  },
  resolve: {
    alias: {
      // Allow server tests to import node modules
    },
  },
});
