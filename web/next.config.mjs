/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output → a small, self-contained server bundle for the container image.
  output: 'standalone',
  // Keep these out of the server bundle: native 'pg' driver, and 'unpdf' (its
  // bundled pdf.js shouldn't be re-bundled/mangled by webpack).
  serverExternalPackages: ['pg', 'unpdf'],
};

export default nextConfig;
