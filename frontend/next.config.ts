import type { NextConfig } from "next";

/**
 * The API is proxied through this server rather than called cross-origin.
 *
 * WHY
 * ---
 * The browser then only ever talks to ONE origin. That has three consequences,
 * and each removes a thing that was breaking:
 *
 *   * CORS stops applying at all — same-origin requests are not preflighted, so
 *     there is no allow-list to keep in sync with wherever the app is opened.
 *   * A phone, a LAN address or a tunnelled HTTPS URL all work unchanged: the
 *     app asks its own origin for /api/v1/... and this server forwards it.
 *   * Installing as a PWA needs one HTTPS tunnel instead of two, and there is
 *     no second URL to rebuild against.
 *
 * BACKEND_ORIGIN is read at SERVER start (not baked into the client bundle), so
 * pointing it at a different backend is a restart, not a rebuild.
 *
 * NEXT_PUBLIC_API_URL still overrides this from the client side when the API
 * genuinely lives on another origin — a separately deployed backend, say. Left
 * unset, the client uses same-origin paths and lands here. See src/lib/api.ts.
 */
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${BACKEND_ORIGIN.replace(/\/$/, "")}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
