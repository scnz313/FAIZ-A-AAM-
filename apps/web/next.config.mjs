/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@fass/contracts"],
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  images: { qualities: [80] },
};

export default nextConfig;
