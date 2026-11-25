"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

import { CockpitGrid } from "@/components/cockpit/CockpitGrid";
import { useScreenOn } from "@/components/cockpit/CockpitFull";
import { PieceBody } from "@/components/cockpit/Pieces";
import { TrackOutline } from "@/components/ui/TrackOutline";
import { TyreDot } from "@/components/ui/Tyres";
import { api, ApiError, setScreenToken } from "@/lib/api";
import { TEMPLATES, type Cockpit } from "@/lib/cockpit";
import { useLive } from "@/lib/live";
import { teamColor } from "@/lib/teams";
import type { Snapshot } from "@/lib/types";
import { WEATHER_ES } from "@/lib/format";
import { useEngineerVoice } from "@/lib/voice";

const KEY = "pantalla-token";
type Me = { name: string; role: string; config: { cockpit?: string; panel?: string }; cockpit: Cockpit | null };

/**
 * A screen around the player (a TV, a tablet, another computer) with no account
 * of its own. Unlinked, it shows a code to scan; linked, it shows what the
 * player chose for it, watching the live data with a read-only token.
 */
export default function ScreenPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let t: string | null = null;
    try {
      t = localStorage.getItem(KEY);
    } catch {}
    setScreenToken(t);
    setToken(t);
  }, []);
  const linked = useCallback((t: string | null) => {
    try {
      if (t) localStorage.setItem(KEY, t);
      else localStorage.removeItem(KEY);
    } catch {}
    setScreenToken(t);
    setToken(t);
  }, []);

  if (token === undefined) return <main className="h-dvh bg-bg" />;
  return token ? <Linked token={token} onUnlinked={() => linked(null)} /> : <Pairing onLinked={linked} />;
}

function Pairing({ onLinked }: { onLinked: (token: string) => void }) {
  const [code, setCode] = useState<{ pairing_id: string; code: string; expires_in_s: number } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [failed, setFailed] = useState(false);

  const start = useCallback(async () => {
    try {
      const c = await api<{ pairing_id: string; code: string; expires_in_s: number }>("/api/screens/pair/start", null, { method: "POST" });
      setCode(c);
      setLeft(c.expires_in_s);
      setFailed(false);
      const url = `${window.location.origin}/vincular?c=${c.code}`;
      setQr(await QRCode.toDataURL(url, { margin: 1, width: 600, color: { dark: "#0b0c0e", light: "#f2f3f5" } }));
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    start();
  }, [start]);

  useEffect(() => {
    if (!code) return;
    const t = setInterval(async () => {
      setLeft((l) => l - 2);
      try {
        const r = await api<{ status: string; token?: string }>(`/api/screens/pair/${code.pairing_id}`, null);
        if (r.status === "linked" && r.token) onLinked(r.token);
        else if (r.status === "expired") start();
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [code, onLinked, start]);

  const shown = code ? `${code.code.slice(0, 3)}·${code.code.slice(3)}` : "······";
  return (
    <main className="grid min-h-dvh items-center gap-12 bg-bg px-[max(1.5rem,6vw)] py-10 lg:grid-cols-[1fr_auto]">
      <div className="flex max-w-[44rem] flex-col gap-6">
        <span className="display text-[1.6rem]">INGENIERO</span>
        <h1 className="display text-[clamp(2.6rem,6vw,5rem)] uppercase">Sumá esta pantalla a tu box</h1>
        <ol className="list-decimal pl-7 text-[clamp(1.1rem,1.8vw,1.5rem)] leading-relaxed text-soft-fg">
          <li>Abrí la cámara de tu celular, donde ya usás la app</li>
          <li>Escaneá el código, o andá a Ajustes → Sumar pantalla y escribilo</li>
          <li>Elegí qué querés ver acá</li>
        </ol>
        <p className="max-w-[36rem] text-[1.05rem] text-dim">No hace falta iniciar sesión en esta pantalla. Queda vinculada a tu cuenta hasta que la quites desde Ajustes.</p>
        {failed && <p className="text-warn">No pude conectarme con el servidor. Reviso de nuevo en unos segundos…</p>}
      </div>
      <div className="flex flex-col items-center gap-4">
        <div className="paper p-5">{qr ? <img src={qr} alt={`Código para vincular: ${shown}`} className="h-[min(300px,60vw)] w-[min(300px,60vw)]" /> : <div className="h-[min(300px,60vw)] w-[min(300px,60vw)]" />}</div>
        <div className="text-center">
          <div className="text-[1rem] text-dim">o escribí el código</div>
          <div className="font-mono text-[2.8rem] tracking-[0.12em]">{shown}</div>
          {code && left > 0 && <div className="text-[0.9rem] text-dim">se renueva en {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</div>}
        </div>
      </div>
    </main>
  );
}

function Linked({ token, onUnlinked }: { token: string; onUnlinked: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const { snapshot: s, status, engineer } = useLive({ overlayToken: token });
  useScreenOn();

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const r = await api<Me>("/api/screens/me", null);
        if (!stopped) setMe(r);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onUnlinked();
      }
    };
    load();
    const t = setInterval(load, 30_000); // a new role from Settings shows up within half a minute
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [onUnlinked]);

  if (!me) return <main className="h-dvh bg-bg" />;
  return (
    <main className="flex h-dvh flex-col gap-3 overflow-hidden bg-bg p-[max(1rem,2vh)]">
      {!s ? (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <p className="display text-[clamp(2rem,5vw,4rem)] uppercase">{me.name}</p>
            <p className="mt-2 text-[1.2rem] text-muted">{status === "offline" ? "Sin conexión con el servidor" : "Esperando que salgas a pista"}</p>
          </div>
        </div>
      ) : (
        <Role me={me} s={s} messages={engineer.messages} />
      )}
    </main>
  );
}

function Role({ me, s, messages }: { me: Me; s: Snapshot; messages: ReturnType<typeof useLive>["engineer"]["messages"] }) {
  switch (me.role) {
    case "tabla":
      return <TvStandings s={s} />;
    case "mapa":
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TvHeader s={s} />
          <TrackOutline trackId={s.track?.id} corners={s.track?.corners} cars={s.cars} className="min-h-0 w-full flex-1" />
        </div>
      );
    case "radio":
      return <TvRadio messages={messages} />;
    case "panel":
      return (
        <div className="h-full" style={{ containerType: "size" }}>
          <PieceBody piece={{ kind: (me.config.panel as never) ?? "rivales", w: 3, h: 4 }} ctx={{ s, messages }} />
        </div>
      );
    case "muro":
    case "cockpit":
    default: {
      // The pit wall on a linked screen is the second-monitor cockpit under the session header.
      const k = (me.role === "cockpit" ? me.cockpit : null) ?? TEMPLATES.find((t) => t.id === "monitor")!;
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {me.role === "muro" && <TvHeader s={s} />}
          <div className="min-h-0 flex-1">
            <CockpitGrid cockpit={k} ctx={{ s, messages }} />
          </div>
        </div>
      );
    }
  }
}

function TvHeader({ s }: { s: Snapshot }) {
  const ses = s.session;
  const race = (ses?.type ?? "").startsWith("Race");
  return (
    <div className="flex flex-wrap items-baseline gap-x-6">
      <span className="display text-[clamp(1.8rem,3.2vw,3rem)] uppercase">{ses?.track ?? "—"}</span>
      {race && <span className="title text-[clamp(1.2rem,2vw,2rem)] text-muted">Vuelta {s.lap?.lap ?? "—"} de {ses?.total_laps ?? "—"}</span>}
      {ses && <span className="ml-auto text-[clamp(1rem,1.6vw,1.5rem)] text-info">{WEATHER_ES[ses.weather] ?? ses.weather}</span>}
    </div>
  );
}

function TvStandings({ s }: { s: Snapshot }) {
  const cars = (s.cars ?? []).filter((c) => c.position > 0 && c.result !== "inactive").sort((a, b) => a.position - b.position);
  const half = Math.ceil(cars.length / 2);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <TvHeader s={s} />
      <div className="grid min-h-0 flex-1 grid-flow-col gap-x-6 gap-y-1.5" style={{ gridTemplateRows: `repeat(${Math.max(half, 1)}, minmax(0,1fr))`, gridTemplateColumns: "1fr 1fr" }}>
        {cars.map((c) => (
          <div key={c.index} className={`flex min-h-0 items-center gap-4 rounded-[10px] px-4 ${c.is_player ? "paper" : "bg-panel"}`} style={{ containerType: "size" }}>
            <span className="display w-[2.2em] text-right" style={{ fontSize: "min(60cqh, 5cqw)" }}>{c.position}</span>
            <span className="h-[60%] w-1.5 rounded" style={{ background: c.color ?? teamColor(c.team_id) }} />
            <span className="min-w-0 flex-1 truncate font-semibold" style={{ fontSize: "min(48cqh, 4.5cqw)" }}>{c.is_player ? "Vos" : c.name ? c.name.charAt(0) + c.name.slice(1).toLowerCase() : `Auto ${c.index + 1}`}</span>
            {c.tyre && <TyreDot compound={c.tyre} size={26} />}
            <span className="display num w-[5em] text-right font-bold not-italic" style={{ fontSize: "min(50cqh, 4.6cqw)" }}>
              {c.position === 1 ? "Líder" : c.gap_leader_ms ? `+${(c.gap_leader_ms / 1000).toFixed(1).replace(".", ",")}` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TvRadio({ messages }: { messages: ReturnType<typeof useLive>["engineer"]["messages"] }) {
  const voice = useEngineerVoice(messages);
  const said = messages.filter((m) => m.radio).slice(-4);
  const last = said[said.length - 1];
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between gap-6 p-[2vw]">
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 rounded-full bg-accent" />
        <span className="title text-[clamp(1.4rem,2.6vw,2.4rem)]">Radio{last?.lap ? ` · vuelta ${last.lap}` : ""}</span>
        {voice.supported && (
          <button type="button" onClick={voice.toggle} className="btn ml-auto px-4 py-2 text-[1rem]">
            {voice.enabled ? "Voz encendida" : "Encender la voz"}
          </button>
        )}
      </div>
      <p className="title text-[clamp(2.2rem,6vw,6rem)] normal-case leading-[1.05]">{last?.radio ?? "Sin mensajes todavía."}</p>
      <div className="flex flex-col gap-2 text-[clamp(1rem,1.6vw,1.4rem)] text-muted">
        {said.slice(0, -1).reverse().map((m) => (
          <span key={m.id} className="truncate">{m.radio}</span>
        ))}
      </div>
    </div>
  );
}
