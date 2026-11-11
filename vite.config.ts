import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const glueUrl = (loadEnv(mode, '.', '').GLUE_URL || 'http://glue-storefront.eu.spryker.local').replace(/\/$/, '');

  return {
    define: {
      __GLUE_URL__: JSON.stringify(glueUrl),
    },
    server: {
      port: 3000,
      strictPort: true,
      // The Storefront API does not allow the `Store` header cross-origin, so the browser calls it through this proxy.
      proxy: {
        '/glue': {
          target: glueUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/glue/, ''),
        },
      },
    },
  };
});
