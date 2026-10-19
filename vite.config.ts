import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works at any URL path (GitHub Pages serves it under /<repo>/)
  base: './',
  plugins: [react()],
  build: {
    // Older phones: iOS 14+ Safari and Android Chrome 87+
    target: ['es2020', 'safari14', 'chrome87'],
    cssTarget: ['safari14', 'chrome87'],
  },
});
