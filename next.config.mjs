/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['exceljs', 'pg', 'bcryptjs'],
  experimental: { serverActions: { bodySizeLimit: '10mb' } },
};
export default nextConfig;
