"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { McpConnectorSection } from "@/components/McpConnectorSection";
import { OverlaySection } from "@/components/OverlaySection";
import { RequireAuth } from "@/components/RequireAuth";
import { ScreensSection, StatusBarSection } from "@/components/settings/ScreensSection";
import { CONTROL, SIDE_BUTTON, Sub } from "@/components/settings/ui";
import { api } from "@/lib/api";
import { PLAN_NAMES, planLine, type Billing } from "@/lib/billing";
import { useAuth } from "@/lib/auth";
import { useTalkAction } from "@/lib/gameButton";
import { useSharedLive } from "@/lib/liveContext";
import { useApi } from "@/lib/sessions";
import { chooseVoice, chosenVoice, previewVoice, spanishVoices } from "@/lib/voice";
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

const GROUPS = [
  { id: "ingeniero", title: "Tu ingeniero" },
  { id: "conexiones", title: "Conexiones" },
  { id: "apariencia", title: "Apariencia" },
  { id: "cuenta", title: "Cuenta" },
] as const;

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  );
}

function Settings() {
  const { email, signOut } = useAuth();

  return (
    <main className="mx-auto max-w-2xl px-[max(1rem,env(safe-area-inset-left))] py-6">
      <h1 className="display text-[2.4rem] uppercase leading-none">Ajustes</h1>
      <nav aria-label="Secciones" className="mt-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {GROUPS.map((g) => (
          <a key={g.id} href={`#${g.id}`} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[0.88rem] text-soft-fg hover:border-muted">
            {g.title}
          </a>
        ))}
      </nav>

      <PlanSection />

      <Group id="ingeniero" title="Tu ingeniero">
        <EngineerCard />
      </Group>

      <Group id="conexiones" title="Conexiones">
        <BridgeSection />
        <ScreensSection />
        <OverlaySection />
        <McpConnectorSection />
      </Group>

      <Group id="apariencia" title="Apariencia">
        <AppearanceSection />
        <StatusBarSection />
      </Group>

      <Group id="cuenta" title="Cuenta">
        <section className="card flex items-center justify-between gap-3 p-4">
          <span className="min-w-0 truncate">{email}</span>
          <button onClick={signOut} className="btn shrink-0 px-3 py-1.5 text-[0.9rem] text-muted hover:text-fg">
            Cerrar sesión
          </button>
        </section>
      </Group>
    </main>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mt-10 scroll-mt-24">
      <h2 className="display mb-4 text-[1.6rem] uppercase leading-none">{title}</h2>
      <div className="flex flex-col gap-7">{children}</div>
    </div>
  );
}

/** The plan as a card at the top: its name, what is left, and the way to more. */
function PlanSection() {
  const { data: b } = useApi<Billing>("/api/billing");
  const free = b?.plan === "gratis";
  return (
    <Link href="/planes" className={`${free ? "card" : "paper"} mt-5 flex flex-col gap-3 p-5 hover:border-accent sm:flex-row sm:items-center sm:justify-between`}>
      <div className="min-w-0">
        <span className="eyebrow">Tu plan</span>
        <p className="display mt-1 text-[2.2rem] uppercase leading-none">{b ? PLAN_NAMES[b.plan] : "…"}</p>
        {b && <p className={`mt-2 text-[0.92rem] ${free ? "text-muted" : "text-[#3d434c]"}`}>{planLine(b)}</p>}
      </div>
      <span className={`${free ? "btn-primary" : "btn-ink"} shrink-0 self-start px-4 py-2 text-[0.92rem] sm:self-center`}>
        {free ? "Convertite en Piloto profesional" : "Ver mi plan"}
      </span>
    </Link>
  );
}

/** The engineer: how it calls you, how it sounds, and the button in the game to talk to it. */
function EngineerCard() {
  return (
    <section className="card flex flex-col divide-y divide-line">
      <div className="p-4 sm:p-5">
        <RadioName />
      </div>
      <div className="p-4 sm:p-5">
        <Voice />
      </div>
      <div className="p-4 sm:p-5">
        <TalkButton />
      </div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="font-semibold">{label}</h3>
        {hint && <p className="text-[0.88rem] text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** How the engineer calls the player on the radio: the game's driver name is the seat they took. */
function RadioName() {
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
    <Field label="Tu nombre en la radio" hint="Así te llama el ingeniero y así aparecés en las clasificaciones.">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="sr-only" htmlFor="nombre-radio">Tu nombre en la radio</label>
        <input
          id="nombre-radio"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setState("idle");
          }}
          maxLength={40}
          placeholder="Ej.: Juanma"
          className={CONTROL}
        />
        <button type="submit" disabled={state === "saving" || name.trim() === (saved ?? "")} className={SIDE_BUTTON}>
          {state === "ok" && name.trim() === (saved ?? "") ? "Guardado" : "Guardar"}
        </button>
      </form>
      {state === "error" && <p className="text-[0.82rem] text-danger">No se pudo guardar.</p>}
    </Field>
  );
}

const COUNTRIES: Record<string, string> = {
  ES: "España", MX: "México", AR: "Argentina", US: "Estados Unidos", CO: "Colombia", CL: "Chile", PE: "Perú",
  UY: "Uruguay", VE: "Venezuela", "419": "Latinoamérica",
};

const NOVELTY = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/;

/** A voice as a person: "Jorge · España" rather than "Jorge (Enhanced) es-ES". */
function voiceLabel(v: SpeechSynthesisVoice): string {
  let name = v.name.split(" - ")[0].replace(/\s*\(.*\)$/, "").replace(/^Microsoft\s+/, "").replace(/\s+Online.*$/, "");
  if (/^Google/i.test(name)) name = "Google";
  const country = COUNTRIES[v.lang.split(/[-_]/)[1]?.toUpperCase() ?? ""];
  return country ? `${name} · ${country}` : name;
}

/** Which of this device's voices reads the radio: they differ a lot from one device to another. */
function Voice() {
  const [voices, setVoices] = useState<{ uri: string; label: string }[]>([]);
  const [uri, setUri] = useState("");
  useEffect(() => {
    const load = () => {
      const seen = new Map<string, number>();
      setVoices(
        // without the novelty voices (Grandma, Rocko…): they are not a radio engineer
        spanishVoices().filter((v) => !NOVELTY.test(v.name)).map((v) => {
          const base = voiceLabel(v);
          const n = (seen.get(base) ?? 0) + 1;
          seen.set(base, n);
          return { uri: v.voiceURI, label: n > 1 ? `${base} (${n})` : base };
        }),
      );
    };
    setUri(chosenVoice());
    load();
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", load);
  }, []);

  return (
    <Field label="Voz" hint="Las voces son las de este dispositivo: probá y quedate con la que mejor suene.">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="voz">Voz del ingeniero</label>
        <select
          id="voz"
          value={uri}
          onChange={(e) => {
            setUri(e.target.value);
            chooseVoice(e.target.value);
          }}
          className={CONTROL}
        >
          <option value="">Automática{voices[0] ? ` (${voices[0].label})` : ""}</option>
          {voices.map((v) => (
            <option key={v.uri} value={v.uri}>
              {v.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => previewVoice(uri, "Box, box. Intermedios. Salís sexto con aire limpio.")} className={SIDE_BUTTON}>
          ▶ Probar
        </button>
      </div>
      {voices.length === 0 && <p className="text-[0.82rem] text-muted">Este navegador no tiene voces en español.</p>}
    </Field>
  );
}

/** A button in the game to talk to the engineer: one of its "UDP Action" buttons. */
function TalkButton() {
  const [action, setAction] = useTalkAction();
  const { snapshot } = useSharedLive();
  const presses = action ? snapshot?.udp_actions?.presses[action - 1] : undefined;
  const [first, setFirst] = useState<number | undefined>(undefined);
  useEffect(() => setFirst(undefined), [action]);
  useEffect(() => {
    if (presses !== undefined && first === undefined) setFirst(presses);
  }, [presses, first]);
  const seen = presses !== undefined && first !== undefined && presses > first;
  const n = action || 1;

  return (
    <Field label="Botón para hablar" hint="Hablale al ingeniero sin soltar el volante, con un botón del volante o del mando.">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="accion-udp">Acción UDP para hablar</label>
        <select id="accion-udp" value={action} onChange={(e) => setAction(Number(e.target.value))} className={CONTROL}>
          <option value={0}>Apagado</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              Acción UDP {i + 1}
            </option>
          ))}
        </select>
        <span
          className={`grid h-11 w-28 shrink-0 place-items-center rounded-[var(--radius-control)] border text-center text-[0.85rem] ${
            !action ? "border-line text-dim" : seen ? "border-ok text-ok" : "border-line text-muted"
          }`}
          aria-live="polite"
        >
          {!action ? "Apagado" : seen ? "✓ Funciona" : snapshot ? "Esperando…" : "Sin juego"}
        </span>
      </div>
      {action > 0 && (
        <ol className="mt-1 flex flex-col gap-2.5 rounded-[var(--radius-control)] bg-panel-2 p-3.5 text-[0.9rem]">
          <Step n={1}>
            En el juego, andá a <b>Opciones → Controles</b> y elegí tu volante o tu mando.
          </Step>
          <Step n={2}>
            Buscá <b>Acción UDP {n}</b> en la lista de botones y asignale uno que no uses para manejar (por ejemplo, uno del volante).
          </Step>
          <Step n={3}>
            Con el juego abierto, apretalo: acá arriba tiene que aparecer <b className="text-ok">✓ Funciona</b>.
          </Step>
          <li className="pl-8 text-[0.85rem] text-muted">
            En carrera, mantenelo apretado mientras hablás y soltalo para mandar. Un toque corto también sirve: escucha hasta que lo vuelvas a tocar.
          </li>
        </ol>
      )}
    </Field>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[0.72rem] font-bold text-accent-fg">{n}</span>
      <span>{children}</span>
    </li>
  );
}

/** Sending now: seen in the last two minutes. */
const online = (d: Device) => !d.revoked_at && !!d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000;

/** The computers running Ingeniero Bridge, which send the game's telemetry. */
function BridgeSection() {
  const { credentials } = useAuth();
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
  const remove = async (d: Device) => {
    const live = !d.revoked_at ? " Deja de poder enviar datos." : "";
    if (!confirm(`¿Eliminar "${d.name}" de la lista?${live} Tus sesiones grabadas no se borran.`)) return;
    await api(`/api/devices/${d.id}?eliminar=true`, await credentials(), { method: "DELETE" });
    load();
  };

  return (
    <section className="flex flex-col gap-3">
      <Sub title="Ingeniero Bridge" hint="Las computadoras que mandan la telemetría de tu juego." action={<Link href="/pair" className="text-[0.9rem] text-accent-ink">+ Vincular otra</Link>} />
      <div className="card flex flex-col">
        {error && <p className="px-4 py-3 text-[0.88rem] text-danger">{error}</p>}
        {devices?.length === 0 && <p className="px-4 py-3 text-[0.9rem] text-muted">Todavía no vinculaste ninguna.</p>}
        {devices?.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3 border-b border-panel-2 px-4 py-3 last:border-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${online(d) ? "bg-ok" : "bg-dim"}`} aria-hidden="true" />
                <span className="truncate font-semibold">{d.name}</span>
              </div>
              <div className="text-[0.82rem] text-dim">
                {d.revoked_at
                  ? "Desvinculada"
                  : online(d)
                    ? "Conectada ahora"
                    : d.last_seen_at
                    ? `Última conexión ${new Date(d.last_seen_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", hour12: false })}`
                    : "Nunca se conectó"}
                {d.last_reception != null && !d.revoked_at && ` · señal ${Math.round(d.last_reception * 100)}%`}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4 text-[0.88rem]">
              {!d.revoked_at && (
                <button onClick={() => revoke(d)} className="text-muted hover:text-fg">
                  Desvincular
                </button>
              )}
              <button onClick={() => remove(d)} className="text-danger">
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  return (
    <section className="flex flex-col gap-3">
      <Sub title="Tema" hint="Vale para este dispositivo." />
      <div className="grid gap-2 sm:grid-cols-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            aria-pressed={theme === t.id}
            className={`card p-3 text-left ${theme === t.id ? "ring-1 ring-accent" : "hover:border-muted"}`}
          >
            <div className="flex gap-1" aria-hidden="true">
              {t.swatch.map((c) => (
                <span key={c} className="h-6 flex-1 rounded-sm border border-black/30" style={{ background: c }} />
              ))}
            </div>
            <div className="mt-2 font-semibold">{t.name}</div>
            <div className="text-[0.8rem] text-muted">{t.description}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
