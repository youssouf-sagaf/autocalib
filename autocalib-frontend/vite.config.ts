import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Vite injects the module script before the CSS link; ensure styles load before JS runs. */
function cssBeforeJs(): Plugin {
  return {
    name: 'css-before-js',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const cssLink = html.match(/<link rel="stylesheet" crossorigin href="[^"]+">/)?.[0];
        const jsScript = html.match(/<script type="module" crossorigin src="[^"]+"><\/script>/)?.[0];
        if (!cssLink || !jsScript) return html;

        const cssHref = cssLink.match(/href="([^"]+)"/)?.[1];
        const withoutAssets = html.replace(cssLink, '').replace(jsScript, '');
        const preload = cssHref
          ? `    <link rel="preload" as="style" href="${cssHref}" crossorigin />\n`
          : '';

        return withoutAssets.replace(
          '</head>',
          `${preload}    ${cssLink}\n    ${jsScript}\n  </head>`,
        );
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), cssBeforeJs()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: '../autocalib-api/static',
    emptyOutDir: true,
  },
});
