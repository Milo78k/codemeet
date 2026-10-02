import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const webDirectory = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../public/monaco/', import.meta.url));

// These standalone module workers are served by Next from the same origin.
// Bundling them separately avoids both an AMD loader and a CDN dependency.
await build({
  absWorkingDir: webDirectory,
  entryPoints: {
    'editor.worker': require.resolve('monaco-editor/editor/editor.worker.js'),
    'ts.worker': require.resolve('monaco-editor/language/typescript/ts.worker.js'),
  },
  outdir: outputDirectory,
  bundle: true,
  splitting: false,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  logLevel: 'info',
});
