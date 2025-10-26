import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
    root: '.',
    plugins: [vue()],
    server: {
        port: 5173,
        strictPort: false,  // Try other ports if 5173 is busy
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true
    },
});
