import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default {
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        persist: false,
        d1Databases: ['DB'],
        kvNamespaces: ['MEDIA'],
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
      },
    }),
  ],
  test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'] },
};
