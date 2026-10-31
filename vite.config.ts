import { defineConfig } from 'vite';

// Base path is configurable for GitHub Pages project sites, e.g.
//   BASE_PATH=/icarus-ascent/ npm run build
// Default './' (relative) works for any static host or sub-folder.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  server: { host: true },
});
