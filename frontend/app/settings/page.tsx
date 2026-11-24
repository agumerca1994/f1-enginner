"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { McpConnectorSection } from "@/components/McpConnectorSection";
import { OverlaySection } from "@/components/OverlaySection";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { THEMES, useTheme } from "@/lib/theme";

type Device = {
  id: number;
  name: string;
  os: string | null;
  bridge_version: string | null;
  last_seen_at: string | null;
  last_reception: number | null;
  revoked_at: string | null;
};

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  );
}

function Settings() {
  const { email, credentials, signOut } = useAuth();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices(await api<Device[]>("/api/devices", await credentials()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [credentials]);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (d: Device) => {
    if (!confirm(`¿Desvincular "${d.name}"? Ese bridge dejará de poder enviar datos.`)) return;
    await api(`/api/devices/${d.id}`, await credentials(), { method: "DELETE" });
    load();
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="display text-3xl">Ajustes</h1>

      <AppearanceSection />

      <section className="mt-4 card p-4">
        <h2 className="label">Cuenta</h2>
        <div className="mt-2 flex items-center justify-between">
          <span>{email}</span>
          <button onClick={signOut} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-fg">
            Salir
          </button>
        </div>
      </section>

      <RadioNameSection />

      <section className="mt-4 flex items-center justify-between card p-4">
        <div>
          <h2 className="label">Consumo de IA</h2>
          <p className="mt-1 text-sm text-muted">Cuánto usó y costó el ingeniero de pista, por día, sesión y modelo.</p>
        </div>
        <Link href="/usage" className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">
          Ver detalle
        </Link>
      </section>

      <section className="mt-4 card p-4">
        <div className="flex items-center justify-between">
          <h2 className="label">Computadoras con el Bridge</h2>
          <Link href="/pair" className="text-sm text-accent underline">
            Vincular otra
          </Link>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        {devices?.length === 0 && <p className="mt-3 text-sm text-muted">Todavía no vinculaste ninguna computadora.</p>}
        <ul className="mt-3 divide-y divide-line">
          {devices?.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="truncate">{d.name}</div>
                <div className="text-xs text-muted">
                  {d.revoked_at
                    ? "Desvinculado"
                    : d.last_seen_at
                      ? `Última conexión ${new Date(d.last_seen_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", hour12: false })}`
                      : "Nunca se conectó"}
                  {d.last_reception != null && !d.revoked_at && ` · señal ${Math.round(d.last_reception * 100)}%`}
                </div>
              </div>
              {!d.revoked_at && (
                <button onClick={() => revoke(d)} className="text-sm text-danger">
                  Desvincular
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <OverlaySection />
      <McpConnectorSection />
    </main>
  );
}

/** The look of the app on this device: Clásico, Carbono or Volante. */
function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  return (
    <section className="mt-6 card p-4">
      <h2 className="label">Apariencia</h2>
      <p className="mt-1 text-sm text-muted">Se guarda en este dispositivo: podés usar uno en el teléfono del volante y otro en la tablet.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            aria-pressed={theme === t.id}
            className={`rounded-[var(--radius-card)] border p-3 text-left ${theme === t.id ? "border-accent bg-accent/10" : "border-line hover:border-muted"}`}
          >
            <div className="flex gap-1" aria-hidden="true">
              {t.swatch.map((c) => (
                <span key={c} className="h-6 flex-1 rounded-sm border border-black/30" style={{ background: c }} />
              ))}
            </div>
            <div className="mt-2 font-semibold">{t.name}</div>
            <div className="text-xs text-muted">{t.description}</div>
          </button>
        ))}
      </div>
      <Link href="/volante" className="mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line p-3 text-sm hover:border-accent">
        <span>
          <span className="font-semibold">Modo volante</span>
          <span className="block text-xs text-muted">Teléfono horizontal arriba del volante: marcha, velocidad, luces de cambio y tiempos.</span>
        </span>
        <span className="text-accent">Abrir</span>
      </Link>
    </section>
  );
}

/** How the engineer calls the player on the radio: the game's driver name is the seat they took. */
function RadioNameSection() {
  const { credentials } = useAuth();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "ok" | "error">("idle");

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ nombre_radio: string | null }>("/api/engineer/settings", await credentials());
        setName(r.nombre_radio ?? "");
        setSaved(r.nombre_radio ?? "");
      } catch {}
    })();
  }, [credentials]);

  const save = async () => {
    setState("saving");
    try {
      const r = await api<{ nombre_radio: string | null }>("/api/engineer/settings", await credentials(), {
        method: "PUT",
        body: { nombre_radio: name.trim() || null },
      });
      setSaved(r.nombre_radio ?? "");
      setState("ok");
    } catch {
      setState("error");
    }
  };

  return (
    <section className="mt-4 card p-4">
      <h2 className="label">Ingeniero de pista</h2>
      <p className="mt-1 text-sm text-muted">
        Cómo te llama por radio. Si lo dejás vacío no usa nombre (nunca el del piloto del juego).
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setState("idle");
          }}
          maxLength={40}
          placeholder="Tu nombre para la radio"
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={state === "saving" || name.trim() === (saved ?? "")}
          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent disabled:opacity-40"
        >
          Guardar
        </button>
      </form>
      {state === "ok" && <p className="mt-1 text-xs text-ok">Guardado.</p>}
      {state === "error" && <p className="mt-1 text-xs text-danger">No se pudo guardar.</p>}
    </section>
  );
}
