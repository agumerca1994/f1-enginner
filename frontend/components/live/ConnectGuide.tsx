"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { LiveStatus } from "@/lib/live";

const DOWNLOAD = "https://github.com/agumerca1994/f1-enginner/releases/latest/download";
const GAME_SETTINGS: [string, string][] = [
  ["Telemetría UDP", "Activada"],
  ["Difusión UDP", "Desactivada"],
  ["Dirección IP", "la de tu compu (la muestra el Bridge)"],
  ["Puerto UDP", "20777"],
  ["Formato UDP", "2024"],
  ["Frecuencia", "20 Hz"],
];

type Device = { id: number; revoked_at: string | null; last_seen_at: string | null };

/**
 * What to do while no data arrives. A new player walks the four steps (install the
 * Bridge, link it, set up the game, go on track); a returning one sees only the last
 * two, with what is already working ticked.
 */
export function ConnectGuide({ status }: { status: LiveStatus }) {
  const { credentials } = useAuth();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices(await api<Device[]>("/api/devices", await credentials()));
    } catch {
      setDevices([]);
    }
  }, [credentials]);
  useEffect(() => {
    load();
  }, [load]);

  if (devices == null) return <p className="py-10 text-center text-muted">Cargando…</p>;
  const linked = devices.some((d) => !d.revoked_at);
  const full = !linked || showAll;

  return (
    <div className="mx-auto mt-4 max-w-xl space-y-3">
      <div>
        <h1 className="display text-3xl">{linked ? "Esperando tu consola" : "Conectá tu consola"}</h1>
        <p className="mt-1 text-muted">
          {linked
            ? "Tu Bridge ya está vinculado. Abrilo en la compu y salí a pista: los datos aparecen acá solos."
            : "Son cuatro pasos y se hacen una sola vez. Después solo abrís el Bridge y salís a pista."}
        </p>
      </div>

      {full && (
        <>
          <Step n={1} title="Instalá Ingeniero Bridge en tu compu" done={linked}>
            <p>Es un programa chiquito que recibe los datos del juego y se los manda a tu ingeniero. La compu tiene que estar en la misma red que la consola.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={`${DOWNLOAD}/ingeniero-bridge-mac.zip`} className="chip px-4 py-3 text-center font-semibold">Mac</a>
              <a href={`${DOWNLOAD}/ingeniero-bridge-windows.zip`} className="chip px-4 py-3 text-center font-semibold">Windows</a>
            </div>
            <p className="mt-2 text-xs">¿Windows avisa que es una app desconocida? Es normal: “Más información” y “Ejecutar de todas formas”.</p>
          </Step>
          <Step n={2} title="Vinculalo con tu cuenta" done={linked}>
            {linked ? <p>Listo, ya está vinculado.</p> : <PairForm onDone={load} />}
          </Step>
        </>
      )}

      <Step n={full ? 3 : 1} title="Configurá la telemetría en el juego" done={status === "live"}>
        <p>En el juego: Ajustes › Telemetría. Dejalo así:</p>
        <dl className="mt-2 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line">
          {GAME_SETTINGS.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-semibold text-fg">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs">Por Wi‑Fi puede faltar algún dato y está bien; con la consola por cable llegan todos.</p>
      </Step>

      <Step n={full ? 4 : 2} title="Salí a pista" done={false} current>
        <ul className="space-y-2">
          <Check ok={status !== "offline"} label={status === "offline" ? "Sin conexión con el servidor: revisá tu internet" : "Conectado al servidor"} />
          <Check ok={linked} label={linked ? "Bridge vinculado" : "Falta vincular el Bridge"} />
          <Check ok={false} spin label="Esperando datos del juego: arrancá cualquier sesión (en los menús no llegan)" />
        </ul>
      </Step>

      {linked && !showAll && (
        <button onClick={() => setShowAll(true)} className="w-full py-2 text-sm text-accent underline">
          Ver todos los pasos
        </button>
      )}
    </div>
  );
}

function Step({ n, title, done, current = false, children }: { n: number; title: string; done: boolean; current?: boolean; children: React.ReactNode }) {
  return (
    <section className={`card p-4 ${current ? "!border-accent/60" : ""}`}>
      <header className="flex items-center gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-ok text-bg" : "bg-panel-2 text-fg"}`}>
          {done ? "✓" : n}
        </span>
        <h2 className="font-semibold">{title}</h2>
      </header>
      {!done || current ? <div className="mt-3 text-sm text-muted">{children}</div> : null}
    </section>
  );
}

function Check({ ok, label, spin = false }: { ok: boolean; label: string; spin?: boolean }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      {ok ? (
        <span className="text-ok">✓</span>
      ) : spin ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-r-transparent" />
      ) : (
        <span className="text-danger">✕</span>
      )}
      <span className={ok ? "text-fg" : ""}>{label}</span>
    </li>
  );
}

function PairForm({ onDone }: { onDone: () => void }) {
  const { credentials } = useAuth();
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    try {
      await api("/api/devices/pair/confirm", await credentials(), { method: "POST", body: { user_code: code } });
      onDone();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo vincular");
      setState("error");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <p>Abrí Ingeniero Bridge: te muestra un código. Escribilo acá.</p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="XXXX-XXXX"
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={9}
        className="num w-full rounded-[var(--radius-control)] border border-line bg-panel-2 px-4 py-3 text-center text-2xl tracking-[0.3em] text-fg outline-none focus:border-accent"
      />
      <button disabled={code.replace("-", "").length !== 8 || state === "sending"} className="btn-primary w-full px-4 py-3 disabled:opacity-40">
        {state === "sending" ? "Vinculando…" : "Vincular"}
      </button>
      {state === "error" && <p className="text-danger">{message}</p>}
    </form>
  );
}
