"use client";

import { useEffect, useState } from "react";

import { AccessGate, type AccessStatus } from "@/components/AccessGate";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Asked once per page load: whether this account is past early access.
let checked: { email: string; status: AccessStatus } | null = null;

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, email, signIn, credentials } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessStatus | null>(checked && checked.email === email ? checked.status : null);

  useEffect(() => {
    if (!email || (checked && checked.email === email)) return;
    let gone = false;
    (async () => {
      try {
        const s = await api<AccessStatus>("/api/access", await credentials());
        checked = { email, status: s };
        if (!gone) setAccess(s);
      } catch {
        // The server still guards every endpoint: if this check fails, let the app try.
        if (!gone) setAccess({ habilitado: true, solicitud: null });
      }
    })();
    return () => {
      gone = true;
    };
  }, [email, credentials]);

  if (!ready) return <p className="p-8 text-center text-muted">Cargando…</p>;
  if (email) {
    if (!access) return <p className="p-8 text-center text-muted">Cargando…</p>;
    if (!access.habilitado)
      return (
        <AccessGate
          status={access}
          onChange={(s) => {
            checked = { email, status: s };
            setAccess(s);
          }}
        />
      );
    return <>{children}</>;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="eyebrow">Ingeniero de pista</div>
      <h1 className="display mt-2 text-[2.6rem] uppercase">Tu box, fuera del juego</h1>
      <p className="mt-3 text-muted">Telemetría en vivo, reglaje y un ingeniero que te habla por radio. Entrá con tu cuenta de Google.</p>
      <button onClick={() => signIn().catch((e) => setError(e.message))} className="btn-primary mt-8 px-4 py-3.5">
        Ingresar con Google
      </button>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <p className="mt-10 text-xs text-muted">Compatible con la telemetría de los juegos EA SPORTS F1® en todas las plataformas. No afiliado a EA ni a Formula 1.</p>
    </main>
  );
}
