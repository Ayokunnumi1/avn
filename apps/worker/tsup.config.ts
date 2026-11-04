import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@avn\//],
  external: ['@prisma/client', 'sharp', 'pdfkit'],
  // Bundled CommonJS dependencies call require(); provide it in the ESM output.
  banner: { js: "import { createRequire as __avnCreateRequire } from 'node:module'; const require = __avnCreateRequire(import.meta.url);" },
});
