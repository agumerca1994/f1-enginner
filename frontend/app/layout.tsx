import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ErrorReporter } from "@/components/ErrorReporter";
import { ServiceWorker } from "@/components/ServiceWorker";
import { AuthProvider } from "@/lib/auth";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ingeniero de carrera",
  description: "Tu ingeniero de IA para EA SPORTS F1® 24: telemetría en vivo, estrategia y avisos por voz.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Ingeniero", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#07090c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased`}>
        <AuthProvider>
          {children}
          <ErrorReporter />
        </AuthProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
