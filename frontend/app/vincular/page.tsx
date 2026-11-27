"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { RequireAuth } from "@/components/RequireAuth";
import { ROLES } from "@/components/settings/ScreensSection";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCockpits } from "@/lib/cockpit";

export default function LinkScreenPage() {
  return (
    <RequireAuth>
      <LinkScreen />
    </RequireAuth>
  );
}

/**
 * The phone side of linking a screen: the code (from the QR, or typed), what the
 * screen will show and its name. The screen picks up its link by itself.
 */
function LinkScreen() {
  const { credentials } = useAuth();
  const { cockpits } = useCockpits();
  const [code, setCode] = useState("");
  const [role, setRole] = useState("tabla");
  const [cockpit, setCockpit] = useState<string | null>(null);
  const [name, setName] = useState("Tele");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setCode(c);
  }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await api("/api/screens/pair/confirm", await credentials(), {
        method: "POST",
        body: { code, role, name: name.trim() || "Pantalla", config: role === "cockpit" ? { cockpit: cockpit ?? cockpits?.[0]?.id } : {} },
      });
      setState("done");
    } catch (err) {
      setState("idle");
      setError(err instanceof ApiError && err.status === 404 ? "Ese código no está en ninguna pantalla ahora. Puede haber vencido: mirá el que muestra la pantalla." : err instanceof ApiError && err.status === 402 ? "Con Debut tenés 1 pantalla vinculada. Desvinculá la otra en Ajustes, o pasate a Temporada (Ajustes → Tu plan) para tener todas las que quieras." : "No se pudo vincular. Probá de nuevo.");
    }
  };

  if (state === "done")
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-[max(1rem,env(safe-area-inset-left))] py-8">
        <h1 className="display text-[2.4rem] uppercase">Listo</h1>
        <p className="text-[1rem] text-soft-fg">{name} ya muestra {ROLES.find((r) => r.id === role)?.name.toLowerCase()}. Le podés cambiar el rol cuando quieras desde Ajustes.</p>
        <Link href="/settings#pantallas" className="btn-primary grid h-12 place-items-center text-[1.05rem]">Ver tus pantallas</Link>
      </main>
    );

  return (
    <main className="mx-auto max-w-md px-[max(1rem,env(safe-area-inset-left))] py-6">
      <form onSubmit={send} className="flex flex-col gap-4">
        <div>
          <span className="eyebrow">Nueva pantalla</span>
          <h1 className="display mt-1 text-[2.2rem] uppercase">¿Qué va a mostrar?</h1>
        </div>
        <label className="flex flex-col gap-1.5 text-[0.85rem] text-muted">
          Código que muestra la pantalla
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required minLength={6} placeholder="K7Q·4MD" autoCapitalize="characters" className="h-12 rounded-[10px] border border-line bg-panel px-3 font-mono text-[1.4rem] tracking-[0.12em] text-fg" />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Rol de la pantalla</legend>
          {ROLES.map((r) => (
            <label key={r.id} className={`flex cursor-pointer items-center gap-3 rounded-[12px] px-4 py-3 ${role === r.id ? "bg-accent/10 ring-2 ring-accent" : "bg-panel"}`}>
              <input type="radio" name="rol" value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} className="accent-[var(--color-accent)]" />
              <span>
                <span className="title block text-[1.15rem]">{r.name}</span>
                <span className="text-[0.85rem] text-muted">{r.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {role === "cockpit" && cockpits && (
          <label className="flex flex-col gap-1.5 text-[0.85rem] text-muted">
            Qué cockpit
            <select value={cockpit ?? cockpits[0].id} onChange={(e) => setCockpit(e.target.value)} className="h-11 rounded-[10px] border border-line bg-panel px-2 text-[0.95rem] text-fg">
              {cockpits.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-[0.85rem] text-muted">
          Nombre de la pantalla
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className="h-11 rounded-[10px] border border-line bg-panel px-3 text-[0.95rem] text-fg" />
        </label>
        {error && <p className="text-[0.9rem] text-warn" role="alert">{error}</p>}
        <button type="submit" disabled={state === "sending"} className="btn-primary h-12 text-[1.1rem]">{state === "sending" ? "Vinculando…" : "Vincular"}</button>
        <p className="text-center text-[0.8rem] text-dim">Podés cambiarle el rol cuando quieras desde Ajustes → Tus pantallas.</p>
      </form>
    </main>
  );
}
