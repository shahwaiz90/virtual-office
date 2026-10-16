import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    watch: {
      ignored: [
        '**/.agents/**',
        '**/tasks.json',
        '**/sprint-plan*.md',
        '**/.gemini/**',
        '**/.opencode/**',
        '**/.claude/**',
        '**/.codex/**',
      ],
    },
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
