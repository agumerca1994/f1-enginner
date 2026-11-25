import type { Metadata, Viewport } from "next";
import { Barlow, JetBrains_Mono, Saira_Condensed, Share_Tech_Mono } from "next/font/google";

import { AppNav } from "@/components/AppNav";
import { ErrorReporter } from "@/components/ErrorReporter";
import { ServiceWorker } from "@/components/ServiceWorker";
import { AuthProvider } from "@/lib/auth";
import { THEME_BOOT } from "@/lib/theme";

import "./globals.css";

const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const sairaCondensed = Saira_Condensed({
  variable: "--font-saira-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800"], // no italic cut exists: the browser slants it
});
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["500"] });
// The Volante skin's LCD digits.
const shareTech = Share_Tech_Mono({ variable: "--font-share-tech", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Ingeniero de carrera",
  description: "Tu ingeniero de IA para EA SPORTS F1® 24: telemetría en vivo, estrategia y avisos por voz.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Ingeniero", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b0c0e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const fonts = [barlow, sairaCondensed, jetbrains, shareTech].map((f) => f.variable).join(" ");

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The font variables sit on <html> because the themes (on <html data-theme>) point at them.
    <html lang="es" className={fonts} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <AuthProvider>
          <AppNav>{children}</AppNav>
          <ErrorReporter />
        </AuthProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
