"use client";

import { useState } from "react";

import { useAuth } from "@/lib/auth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, email, signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (!ready) return <p className="p-8 text-center text-muted">Cargando…</p>;
  if (email) return <>{children}</>;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Ingeniero de carrera</h1>
      <p className="mt-2 text-muted">
        Tu ingeniero de IA para EA SPORTS F1® 24. Ingresá para ver tu telemetría en vivo.
      </p>
      <button
        onClick={() => signIn().catch((e) => setError(e.message))}
        className="mt-8 rounded-xl bg-fg px-4 py-3 font-semibold text-bg hover:opacity-90"
      >
        Ingresar con Google
      </button>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <p className="mt-10 text-xs text-muted">No afiliado a EA ni a Formula 1. Compatible con la telemetría de EA SPORTS F1® 24.</p>
    </main>
  );
}
