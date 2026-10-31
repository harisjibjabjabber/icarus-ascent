import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';

// Build version: short commit + build time. Baked into the bundle (__BUILD_VERSION__)
// and emitted as version.json so a running page can notice a newer deploy.
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; }
}
const builtAt = new Date().toISOString();
const VERSION = `${commit()}-${builtAt.replace(/[-:]/g, '').slice(0, 13)}`;

function versionFile(): Plugin {
  return {
    name: 'icarus-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION, commit: commit(), builtAt }) + '\n' });
    },
  };
}

// Base path is configurable for GitHub Pages project sites, e.g.
//   BASE_PATH=/icarus-ascent/ npm run build
// Default './' (relative) works for any static host or sub-folder.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  server: { host: true },
  define: { __BUILD_VERSION__: JSON.stringify(VERSION) },
  plugins: [versionFile()],
});
