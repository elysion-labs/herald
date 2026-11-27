/// <reference types="veldorajs/node" />

import { hash } from 'node:crypto';

import { defineConfig } from '@byc/vp-config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite-plus';

const devCsp: Plugin = {
  name: 'herald:dev-csp',
  apply: 'serve',
  transformIndexHtml: {
    order: 'post',
    handler(html) {
      const meta = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i.exec(html)?.[0];

      if (!meta) {
        return;
      }

      const preamble =
        /<script type="module">(\s*import \{ injectIntoGlobalHook \} from "[^"]*\/@react-refresh";[^<]*)<\/script>/.exec(
          html,
        )?.[1];

      let policy = meta.replace(
        "connect-src 'none'",
        "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
      );

      if (preamble) {
        const digest = hash('sha256', preamble.replaceAll(/\r\n?/g, '\n'), 'base64');
        policy = policy.replace("script-src 'self'", `script-src 'self' 'sha256-${digest}'`);
      }

      // Vite 会把开发脚本插到 head 开头，CSP 必须在这些脚本之前生效。
      return html.replace(meta, '').replace('<head>', `<head>\n    ${policy}`);
    },
  },
};

export default defineConfig(
  {
    veldora: {
      main: {},
      preload: {
        build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
      },
      renderer: { plugins: [react(), tailwindcss(), devCsp], resolve: { tsconfigPaths: true } },
    },
  },
  { stylistic: true },
);
