import type { NextConfig } from 'next';
// PDF.js and its native canvas/worker loader must keep their Node resolution.
const nextConfig:NextConfig={serverExternalPackages:['pdf-parse','@napi-rs/canvas']};
export default nextConfig;
