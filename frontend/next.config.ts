import type { NextConfig } from "next";

// Same approach as registrapp: the Firebase token lives in the browser, so a
// CSP limits what an XSS could reach. Report-Only until it has run clean.
const API_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").origin;
  } catch {
    return "http://localhost:8000";
  }
})();
const API_WS_ORIGIN = API_ORIGIN.replace(/^http/, "ws");

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    API_ORIGIN,
    API_WS_ORIGIN,
    "https://*.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://identitytoolkit.googleapis.com",
  ].join(" "),
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

// Google sign-in served from our own domain. With the default authDomain
// (<project>.firebaseapp.com) the sign-in handler is third-party to the app,
// and browsers that partition its storage (Safari, Brave, windows opened by
// another app such as Claude's connector flow) fail with "missing initial
// state". Proxying /__/auth here and setting NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN to
// the app's own domain keeps the whole flow first-party.
const FIREBASE_HOSTING = `https://${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "f1-engineer"}.firebaseapp.com`;

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  async rewrites() {
    return [{ source: "/__/auth/:path*", destination: `${FIREBASE_HOSTING}/__/auth/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: CSP },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The microphone is needed from P4 on, for push-to-talk with the engineer.
          { key: "Permissions-Policy", value: "camera=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
