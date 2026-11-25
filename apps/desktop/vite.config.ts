/// <reference types="veldorajs/node" />

import { defineConfig } from '@byc/vp-config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig(
  {
    veldora: {
      main: {},
      preload: {
        build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
      },
      renderer: { plugins: [react(), tailwindcss()], resolve: { tsconfigPaths: true } },
    },
  },
  { stylistic: true },
);
