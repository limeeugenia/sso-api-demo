import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const storefrontUrl = withoutTrailingSlash(env.GLUE_STOREFRONT_URL || 'http://glue-storefront.eu.spryker.local');
  const backendUrl = withoutTrailingSlash(env.GLUE_BACKEND_URL || 'http://glue-backend.eu.spryker.local');

  return {
    define: {
      __GLUE_STOREFRONT_URL__: JSON.stringify(storefrontUrl),
      __GLUE_BACKEND_URL__: JSON.stringify(backendUrl),
    },
    server: {
      port: 3000,
      strictPort: true,
      // The browser calls each API through this proxy. A direct call fails CORS: for example, the Storefront API does not allow the `Store` header cross-origin.
      proxy: {
        '/glue-storefront': proxyTo(storefrontUrl, '/glue-storefront'),
        '/glue-backend': proxyTo(backendUrl, '/glue-backend'),
      },
    },
  };
});

function proxyTo(target: string, prefix: string) {
  return {
    target,
    changeOrigin: true,
    rewrite: (path: string) => path.slice(prefix.length),
  };
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}
