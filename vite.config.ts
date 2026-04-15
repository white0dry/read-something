import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: '/read-something/',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      optimizeDeps: {
        // Keep mobi parser out of pre-bundling so alias patches are applied consistently.
        exclude: ['@lingo-reader/mobi-parser', '@lingo-reader/shared'],
      },
      plugins: [
        {
          name: 'patch-lingo-mobi-parser-toc',
          enforce: 'pre',
          transform(code, id) {
            if (!id.includes('@lingo-reader/mobi-parser/dist/index.browser.mjs')) {
              return null;
            }
            let patched = code;
            const tocTarget = 'this.parseNavMap(tocAst.wrapper.children, toc);';
            if (patched.includes(tocTarget)) {
              patched = patched.replace(
                tocTarget,
                'this.parseNavMap((tocAst && tocAst.wrapper && tocAst.wrapper.children) || [], toc);'
              );
            }

            const coverTarget = 'if (offset) {';
            if (patched.includes(coverTarget)) {
              patched = patched.replace(coverTarget, 'if (offset !== void 0) {');
            }

            return patched === code ? null : patched;
          },
        },
        react(),
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      build: {
        rollupOptions: {
          output: {
            onlyExplicitManualChunks: true,
            manualChunks(id) {
              if (id.includes('node_modules/@xenova/transformers')) return 'vendor-transformers';
              if (id.includes('node_modules/onnxruntime-web')) return 'vendor-onnxruntime';
            },
          },
        },
      },
      resolve: {
        alias: {
          '@lingo-reader/shared': path.resolve(__dirname, 'utils/lingoReaderSharedCompat.ts'),
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
