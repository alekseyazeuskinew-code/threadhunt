import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@threadhunt/shared'],
  // Монорепо: фиксируем корень трассировки, чтобы Next не путал его с домашней папкой.
  outputFileTracingRoot: join(__dirname, '../../'),
  async rewrites() {
    // Проксируем /api/* на бэкенд (Fastify на :3001) в деве.
    const api = process.env.API_ORIGIN || 'http://localhost:3010';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};
export default nextConfig;
