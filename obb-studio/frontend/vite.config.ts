import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cocoparks-theme': path.resolve(__dirname, '../../autocalib-frontend/src/theme'),
    },
  },
  server: {
    port: 5174,
    open: true,
  },
});
