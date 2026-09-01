/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@fass/contracts"],
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  images: { qualities: [80] },
  /* Three-portal consolidation: /administrator/* and /principal/* are
     canonical staff portal prefixes that transparently resolve to the
     shared /staff/* implementation. The URL bar keeps the canonical prefix;
     the staff layout enforces profile-based redirects. */
  async rewrites() {
    return [
      { source: "/administrator", destination: "/staff" },
      { source: "/administrator/:path*", destination: "/staff/:path*" },
      { source: "/principal", destination: "/staff" },
      { source: "/principal/:path*", destination: "/staff/:path*" },
    ];
  },
};

export default nextConfig;
