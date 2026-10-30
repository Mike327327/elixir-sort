import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Vygeneruje service worker (sw.js) se seznamem všech souborů buildu.
 * Šablona je v src/sw-template.js, placeholdery __PRECACHE__ a __VERSION__.
 * Bez externích závislostí (žádný Workbox).
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'elixir-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const bundleFiles = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const publicDir = 'public';
      const publicFiles: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else publicFiles.push(relative(publicDir, full).split('\\').join('/'));
        }
      };
      walk(publicDir);

      const files = Array.from(new Set(['./', ...bundleFiles, ...publicFiles]))
        .filter((f) => f !== 'sw.js')
        .map((f) => (f === './' ? f : `./${f}`))
        .sort();

      const hash = createHash('sha256');
      for (const f of bundleFiles.sort()) {
        const chunk = bundle[f];
        hash.update(f);
        if (chunk.type === 'asset') hash.update(typeof chunk.source === 'string' ? chunk.source : Buffer.from(chunk.source));
        else hash.update(chunk.code);
      }
      const version = hash.digest('hex').slice(0, 12);

      const template = readFileSync('src/sw-template.js', 'utf8');
      const source = template
        .replace('__PRECACHE__', JSON.stringify(files, null, 2))
        .replace('__VERSION__', version);

      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorkerPlugin()],
  worker: {
    format: 'es',
  },
  build: {
    target: ['es2022', 'safari16'],
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    host: true,
  },
});
