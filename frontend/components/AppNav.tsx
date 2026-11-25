"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { StatusBar } from "@/components/ui/StatusBar";
import { useAuth } from "@/lib/auth";
import { LiveProvider } from "@/lib/liveContext";

// Screens that draw their own full-screen layout: overlays for OBS, linked screens,
// the cockpit, the replay player and the sign-in flow.
const BARE = ["/overlay", "/oauth", "/volante", "/replay", "/pantalla", "/cockpit"];
// Linked screens and overlays watch with their own token, outside the signed-in app.
const NO_LIVE = ["/overlay", "/oauth", "/pantalla"];

const TABS = [
  {
    href: "/",
    label: "Sesión",
    match: (p: string) => p === "/" || p.startsWith("/box") || p.startsWith("/reglaje") || p.startsWith("/resumen"),
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
  {
    href: "/circuitos",
    label: "Circuitos",
    match: (p: string) => p.startsWith("/circuitos") || p.startsWith("/sessions"),
    icon: <path d="M5 18c-2-3 0-6 3-6s3-5 6-6 6 2 5 5-4 2-4 5 3 4 0 5-8 0-10-3Z" />,
  },
  {
    href: "/settings",
    label: "Ajustes",
    match: (p: string) => p.startsWith("/settings") || p.startsWith("/usage") || p.startsWith("/pair") || p.startsWith("/vincular"),
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
  },
];

/** The app's navigation: three tabs at the bottom on a phone, a bar on top on bigger screens. */
export function AppNav({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const { email } = useAuth();
  if (!email || NO_LIVE.some((p) => path.startsWith(p))) return <>{children}</>;
  if (BARE.some((p) => path.startsWith(p))) return <LiveProvider>{children}</LiveProvider>;

  return (
    <LiveProvider>
      <div className="sticky top-0 z-30 bg-bg/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <StatusBar />
        <nav className="hidden border-b border-line lg:block" aria-label="Secciones">
          <div className="mx-auto flex h-[60px] max-w-[1600px] items-center gap-7 px-6">
            <Link href="/" className="display text-[1.4rem] tracking-wide">
              INGENIERO
            </Link>
            <div className="flex gap-1">
              {TABS.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={t.match(path) ? "page" : undefined}
                  className={`rounded-[var(--radius-control)] px-3.5 py-2 text-[0.95rem] ${t.match(path) ? "bg-panel-2 font-semibold text-fg" : "text-muted hover:text-fg"}`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
            <Link href="/settings#pantallas" className="btn ml-auto px-3 py-1.5 text-[0.85rem] text-muted">
              Tus pantallas
            </Link>
          </div>
        </nav>
        <header className="flex h-[52px] items-center justify-between border-b border-line px-[max(1.1rem,env(safe-area-inset-left))] lg:hidden">
          <Link href="/" className="display text-[1.3rem]">
            INGENIERO
          </Link>
          <span className="eyebrow">{TABS.find((t) => t.match(path))?.label ?? ""}</span>
        </header>
      </div>
      <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Secciones"
      >
        {TABS.map((t) => {
          const on = t.match(path);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`title flex flex-col items-center gap-1 py-2.5 text-[0.8rem] ${on ? "text-accent-ink" : "text-dim"}`}
              aria-current={on ? "page" : undefined}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {t.icon}
              </svg>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </LiveProvider>
  );
}
