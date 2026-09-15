/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@fass/contracts"],
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  images: { qualities: [80] },
  /* Production security headers. Scripts keep 'unsafe-inline' until a nonce
     pipeline exists (Next.js inline bootstrap); everything else is locked to
     self plus the Supabase project host at runtime. */
  async headers() {
    const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
      : null;
    const connectSrc = ["'self'", supabaseHost ? `https://${supabaseHost}` : null, supabaseHost ? `wss://${supabaseHost}` : null]
      .filter(Boolean)
      .join(" ");
    const contentSecurityPolicy = [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      process.env.NODE_ENV === "production" ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      `connect-src ${connectSrc}`,
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
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
