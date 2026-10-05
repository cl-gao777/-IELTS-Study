import type { NextConfig } from 'next';
// PDF.js and its native canvas/worker loader must keep their Node resolution.
const nextConfig:NextConfig={serverExternalPackages:['pdf-parse','@napi-rs/canvas'],experimental:{proxyClientMaxBodySize:'360mb'}};
export default nextConfig;
