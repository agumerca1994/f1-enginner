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

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
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
