"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { McpConnectorSection } from "@/components/McpConnectorSection";
import { OverlaySection } from "@/components/OverlaySection";
import { RequireAuth } from "@/components/RequireAuth";
import { ScreensSection, StatusBarSection } from "@/components/settings/ScreensSection";
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
    <main className="mx-auto max-w-2xl px-[max(1rem,env(safe-area-inset-left))] py-6">
      <h1 className="display text-[2.4rem] uppercase">Ajustes</h1>

      <PlanSection />

      <Group title="Tu ingeniero">
        <RadioNameSection />
        <VoiceSection />
        <TalkButtonSection />
      </Group>

      <Group title="Conexión">
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="label">Computadoras con el Bridge</h2>
            <Link href="/pair" className="text-sm text-accent underline">
              Vincular otra
            </Link>
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          {devices?.length === 0 && <p className="mt-3 text-sm text-muted">Todavía no vinculaste ninguna.</p>}
          <ul className="mt-3 divide-y divide-line">
            {devices?.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate">{d.name}</div>
                  <div className="text-xs text-muted">
                    {d.revoked_at
                      ? "Desvinculada"
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
        <ScreensSection />
      </Group>

      <Group title="Cómo se ve">
        <AppearanceSection />
        <StatusBarSection />
      </Group>

      <Group title="Extras">
        <OverlaySection />
        <McpConnectorSection />
        <section className="flex items-center justify-between card p-4">
          <div>
            <h2 className="label">Consumo del ingeniero</h2>
            <p className="mt-1 text-sm text-muted">Cuánto habló por sesión.</p>
          </div>
          <Link href="/usage" className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">
            Ver
          </Link>
        </section>
      </Group>

      <Group title="Cuenta">
        <section className="card flex items-center justify-between gap-3 p-4">
          <span className="min-w-0 truncate">{email}</span>
          <button onClick={signOut} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-fg">
            Cerrar sesión
          </button>
        </section>
      </Group>
    </main>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-9">
      <h2 className="display mb-3 text-[1.5rem] uppercase leading-none">{title}</h2>
      <div className="flex flex-col gap-3 [&>section]:mt-0">{children}</div>
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
        {free ? "Pasate a Piloto profesional" : "Ver mi plan"}
      </span>
    </Link>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  return (
    <section className="card p-4">
      <h2 className="label">Tema</h2>
      <p className="mt-1 text-sm text-muted">Vale para este dispositivo.</p>
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
    </section>
  );
}

/** Which of this device's voices reads the radio: they differ a lot from one device to another. */
function VoiceSection() {
  const [voices, setVoices] = useState<{ uri: string; label: string }[]>([]);
  const [uri, setUri] = useState("");
  useEffect(() => {
    const load = () =>
      setVoices(spanishVoices().map((v) => ({ uri: v.voiceURI, label: `${v.name.replace(/\s*\(.*\)$/, "")} · ${v.lang}` })));
    setUri(chosenVoice());
    load();
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", load);
  }, []);

  return (
    <section className="mt-4 card p-4">
      <h2 className="label">Voz</h2>
      <p className="mt-1 text-sm text-muted">Probá y quedate con la que mejor suene en este dispositivo.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={uri}
          onChange={(e) => {
            setUri(e.target.value);
            chooseVoice(e.target.value);
          }}
          className="min-w-0 max-w-full rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        >
          <option value="">Automática{voices[0] ? ` (${voices[0].label})` : ""}</option>
          {voices.map((v) => (
            <option key={v.uri} value={v.uri}>
              {v.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => previewVoice(uri, "Box, box. Intermedios. Salís sexto con aire limpio.")}
          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
        >
          Probar
        </button>
      </div>
      {voices.length === 0 && <p className="mt-2 text-sm text-muted">Este navegador no tiene voces en español.</p>}
    </section>
  );
}

/** A button in the game to talk to the engineer: one of its "UDP Action" buttons. */
function TalkButtonSection() {
  const [action, setAction] = useTalkAction();
  const { snapshot } = useSharedLive();
  const presses = action ? snapshot?.udp_actions?.presses[action - 1] : undefined;
  const [first, setFirst] = useState<number | undefined>(undefined);
  useEffect(() => setFirst(undefined), [action]);
  useEffect(() => {
    if (presses !== undefined && first === undefined) setFirst(presses);
  }, [presses, first]);
  const seen = presses !== undefined && first !== undefined && presses > first;

  return (
    <section className="mt-4 card p-4">
      <h2 className="label">Botón para hablar</h2>
      <p className="mt-1 text-sm text-muted">
        Hablale sin soltar el volante. En el juego, en Controles, asigná «Acción UDP» con este número a un botón libre.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          value={action}
          onChange={(e) => setAction(Number(e.target.value))}
          className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        >
          <option value={0}>Apagado</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              Acción UDP {i + 1}
            </option>
          ))}
        </select>
        {action > 0 && (
          <span className={`text-sm ${seen ? "text-ok" : "text-muted"}`}>
            {seen ? "Recibido: el botón funciona." : snapshot ? "Apretalo en el juego para probarlo." : "Con el juego abierto podés probarlo acá."}
          </span>
        )}
      </div>
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
      <h2 className="label">Tu nombre en la radio</h2>
      <p className="mt-1 text-sm text-muted">Así te llama el ingeniero y así aparecés en las clasificaciones.</p>
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
          placeholder="Ej.: Juanma"
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
