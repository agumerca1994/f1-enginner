"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/lib/auth";

// Screens that draw their own full-screen layout: overlays for OBS, the wheel
// dashboard, the replay player (its bar sits at the bottom) and the sign-in flow.
const BARE = ["/overlay", "/oauth", "/volante", "/replay"];

const TABS = [
  { href: "/", label: "En pista", match: (p: string) => p === "/", icon: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2" /> },
  {
    href: "/sessions",
    label: "Sesiones",
    match: (p: string) => p.startsWith("/sessions") || p.startsWith("/box"),
    icon: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  },
  {
    href: "/reglaje",
    label: "Reglaje",
    match: (p: string) => p.startsWith("/reglaje"),
    icon: (
      <>
        <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="10" cy="12" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>
    ),
  },
  {
    href: "/settings",
    label: "Ajustes",
    match: (p: string) => p.startsWith("/settings") || p.startsWith("/usage") || p.startsWith("/pair"),
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
  },
];

/** The app's navigation: four tabs at the bottom on a phone, a bar on top on bigger screens. */
export function AppNav({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const { email } = useAuth();
  if (!email || BARE.some((p) => path.startsWith(p))) return <>{children}</>;

  return (
    <>
      <nav className="sticky top-0 z-30 hidden border-b border-line bg-bg/90 backdrop-blur lg:block">
        <div className="mx-auto flex max-w-[1800px] items-center gap-6 px-5 py-2.5">
          <Link href="/" className="label !text-fg !text-sm">
            Ingeniero de pista
          </Link>
          <div className="flex gap-1">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-lg px-3 py-1.5 text-sm ${t.match(path) ? "bg-panel-2 text-accent" : "text-muted hover:text-fg"}`}
              >
                {t.label}
              </Link>
            ))}
          </div>
          <Link href="/volante" className="chip ml-auto px-3 py-1.5 text-sm text-muted hover:text-fg">
            Modo volante
          </Link>
        </div>
      </nav>
      <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Secciones"
      >
        {TABS.map((t) => {
          const on = t.match(path);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[0.7rem] ${on ? "text-accent" : "text-muted"}`}
              aria-current={on ? "page" : undefined}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {t.icon}
              </svg>
              <span className="label !text-current !tracking-wide">{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
