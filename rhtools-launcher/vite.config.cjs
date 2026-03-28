const { defineConfig } = require('vite');
const vue = require('@vitejs/plugin-vue');
const path = require('path');

module.exports = defineConfig({
  root: path.join(__dirname, 'renderer'),
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.join(__dirname, 'renderer', 'index.html'),
        progress: path.join(__dirname, 'renderer', 'progress.html')
      }
    }
  },
  server: {
    port: 5174,
    strictPort: true
  }
});
