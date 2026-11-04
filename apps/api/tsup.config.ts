import { defineConfig } from 'tsup';

// Bundles workspace packages (@avn/*) into the output; third-party deps stay external.
export default defineConfig({
  entry: ['src/index.ts', 'src/scripts/seed.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@avn\//],
  external: ['@prisma/client', 'sharp', 'pdfkit'],
});
