"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PLAN_NAMES, type Billing, type Product } from "@/lib/billing";
import { shortDate, useApi } from "@/lib/sessions";
import { LoadingScreen } from "@/components/brand/LogoLoader";
import { EngineerDemo } from "@/components/plans/EngineerDemo";

export default function PlansPage() {
  return (
    <RequireAuth>
      <Plans />
    </RequireAuth>
  );
}

// The how-to for connecting the player's AI (Claude, ChatGPT) to their sessions.
const AI_GUIDE_URL = "https://web-f1.imanzanastore.com.ar/instructivos#claude";

const PRO_POINTS: [string, string][] = [
  ["Estrategia y paradas", "Arma el plan antes de largar y lo cambia sobre la marcha si llueve, si sale el safety car o si las gomas no dan más."],
  ["Gomas y desgaste", "Sigue el desgaste y la temperatura de cada goma, y te avisa antes de que se te caigan."],
  ["Más rápido, curva por curva", "Compara cada curva con tu mejor paso y te dice dónde frenás de más y dónde podés acelerar antes."],
  ["Le hablás y te contesta", "Preguntale lo que quieras con la voz, sin soltar el volante. Se acuerda de todo el fin de semana."],
];

const pesos = (n: number) => `$ ${n.toLocaleString("es-AR")}`;

/** The plans page: what the player has, how each engineer sounds, and the ways to pay. */
function Plans() {
  const { credentials } = useAuth();
  const [rev, setRev] = useState(0);
  const { data: b } = useApi<Billing>("/api/billing", rev);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [back, setBack] = useState<{ ref: string; simulated: boolean } | null>(null);

  // Back from Mercado Pago (or the simulated checkout): check the payment now.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const preapproval = q.get("preapproval_id");
    if (preapproval || q.get("suscripcion")) {
      void confirmSub(preapproval);
      return;
    }
    const ref = q.get("ref");
    if (!ref) return;
    const simulated = q.get("simulado") === "1";
    setBack({ ref, simulated });
    if (simulated) return;
    (async () => {
      try {
        const r = await api<{ estado: string }>(`/api/billing/sync?ref=${encodeURIComponent(ref)}`, await credentials(), { method: "POST" });
        setNote(r.estado === "aprobado" ? "Listo, ya tenés tus carreras con el ingeniero Pro." : "Mercado Pago todavía no confirmó el pago. Puede tardar unos minutos; esta pantalla se actualiza sola.");
        setRev((x) => x + 1);
      } catch {
        setNote("No pudimos revisar el pago ahora. Si pagaste, se acredita solo en unos minutos.");
      }
      window.history.replaceState(null, "", "/planes");
    })();
  }, [credentials]);

  // Back from subscribing (or the button below): bind the new subscription to this account.
  async function confirmSub(preapproval: string | null) {
    setBusy("confirmar");
    try {
      const q = preapproval ? `?preapproval_id=${encodeURIComponent(preapproval)}` : "";
      const r = await api<{ estado: string }>(`/api/billing/subscription/confirm${q}`, await credentials(), { method: "POST" });
      setNote(r.estado === "aprobado" ? "Listo, ya sos Piloto profesional." : "Mercado Pago todavía no nos avisó. Si ya pagaste, probá de nuevo en un minuto.");
      setRev((x) => x + 1);
    } catch {
      setNote("No pudimos revisarlo ahora. Probá de nuevo en un minuto.");
    }
    setBusy(null);
    window.history.replaceState(null, "", "/planes");
  }

  const buy = async (id: Product["id"]) => {
    setBusy(id);
    setNote(null);
    try {
      const r = await api<{ url: string }>("/api/billing/checkout", await credentials(), { method: "POST", body: { producto: id } });
      window.location.href = r.url;
    } catch (e) {
      setNote(e instanceof ApiError && e.status === 503 ? "Los pagos todavía no están habilitados. Muy pronto." : "No se pudo iniciar el pago. Probá de nuevo.");
      setBusy(null);
    }
  };

  const simulate = async () => {
    if (!back) return;
    await api(`/api/billing/simulate?ref=${encodeURIComponent(back.ref)}`, await credentials(), { method: "POST" });
    setBack(null);
    setNote("Pago simulado aprobado.");
    window.history.replaceState(null, "", "/planes");
    setRev((x) => x + 1);
  };

  const cancel = async () => {
    if (!confirm("¿Cancelar Piloto profesional? Lo seguís usando hasta el final del mes que pagaste.")) return;
    await api("/api/billing/cancel", await credentials(), { method: "POST" });
    setRev((x) => x + 1);
  };

  if (!b) return <main className="mx-auto max-w-[1000px] px-4 pt-6"><LoadingScreen /></main>;
  const season = b.productos.find((p) => p.id === "suscripcion")!;
  const packs = b.productos.filter((p) => p.id !== "suscripcion");
  const radioLeft = b.avisos_mes.incluidas == null ? null : Math.max(0, b.avisos_mes.incluidas - b.avisos_mes.usadas);
  const inSeason = b.plan === "suscripcion";
  // When the plan ends, if it does: a subscription renews or ends, a courtesy plan may never end.
  const term: { text: string; warn?: boolean } | null =
    b.plan === "cortesia"
      ? { text: b.hasta ? `Vence el ${shortDate(b.hasta)}` : "No vence" }
      : inSeason && b.hasta
        ? b.renovacion === "cancelled"
          ? { text: `Termina el ${shortDate(b.hasta)}`, warn: true }
          : { text: `Se renueva el ${shortDate(b.hasta)}` }
        : { text: "No vence" };

  return (
    <main className="mx-auto flex max-w-[1000px] flex-col gap-8 px-[max(1rem,env(safe-area-inset-left))] py-5 lg:gap-10 lg:py-8">
      {back?.simulated && (
        <section className="paper flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <span>Pagos de prueba: no hay Mercado Pago configurado en este entorno.</span>
          <button type="button" onClick={() => void simulate()} className="btn-ink px-4 py-2">Simular pago aprobado</button>
        </section>
      )}

      {/* Where the player stands */}
      <header className="flex flex-col gap-4">
        <Link href="/settings" className="text-[0.9rem] text-muted">‹ Ajustes</Link>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <span className="eyebrow">Tu plan</span>
            <h1 className="display mt-1 text-[3.4rem] uppercase leading-[0.9] lg:text-[4.2rem]">{PLAN_NAMES[b.plan]}</h1>
            {term && (
              <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.85rem] ${term.warn ? "border-warn text-warn" : "border-line text-soft-fg"}`}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
                {term.text}
              </span>
            )}
          </div>
        </div>
        <Included b={b} radioLeft={radioLeft} />
        {note && <p className="paper px-4 py-3 text-[0.95rem]">{note}</p>}
        {!b.limites && <p className="text-[0.85rem] text-dim">Mientras dure la beta, todo está incluido para todos.</p>}
      </header>

      {/* The plans */}
      <section className="flex flex-col gap-4">
        <h2 className="display text-[2rem] uppercase leading-none">Elegí cómo correr</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className={`card flex flex-col gap-4 p-5 ${b.plan === "gratis" ? "ring-1 ring-line" : ""}`}>
            <PlanHead name="Piloto rookie" price="$ 0" current={b.plan === "gratis"} />
            <ul className="flex flex-col gap-2 text-[0.95rem]">
              <Item strong>{b.prueba_inicial === 1 ? "1 carrera" : `${b.prueba_inicial} carreras`} con el ingeniero Pro, de regalo</Item>
              <Item>Radio de avisos en {b.avisos_por_mes} carreras por mes</Item>
              <Item>Telemetría, reglaje y clasificaciones</Item>
            </ul>
          </div>

          <div className="paper relative flex flex-col gap-4 p-5">
            <span className="absolute -top-3 left-5 rounded-full bg-accent px-3 py-0.5 text-[0.72rem] font-semibold uppercase tracking-wider text-white">
              La más elegida
            </span>
            <PlanHead name="Piloto profesional" price={pesos(season.ars)} per="/mes" current={inSeason} light />
            <ul className="flex flex-col gap-2 text-[0.95rem]">
              <Item strong>{b.carreras_por_mes} carreras con el ingeniero Pro todos los meses</Item>
              <Item>Radio de avisos en todas tus carreras</Item>
              <Item>Conexión con tu IA</Item>
              <Item>Todas las pantallas que quieras</Item>
            </ul>
            <div className="mt-auto flex flex-col gap-2">
              {inSeason ? (
                b.renovacion !== "cancelled" ? (
                  <button type="button" onClick={() => void cancel()} className="self-start text-[0.85rem] text-[#5b616b] underline">Cancelar Piloto profesional</button>
                ) : (
                  <span className="text-[0.85rem] text-[#5b616b]">Cancelada: la usás hasta que termine el mes.</span>
                )
              ) : b.plan === "gratis" && b.suscripcion_pendiente ? (
                <>
                  <button type="button" onClick={() => void confirmSub(null)} disabled={busy != null} className="btn-ink px-5 py-3 disabled:opacity-50">
                    {busy === "confirmar" ? "Revisando…" : "Ya pagué: activar"}
                  </button>
                  <button type="button" onClick={() => void buy("suscripcion")} disabled={busy != null} className="self-start text-[0.85rem] text-[#5b616b] underline">
                    Volver a Mercado Pago
                  </button>
                </>
              ) : b.plan === "gratis" ? (
                <>
                  <button type="button" onClick={() => void buy("suscripcion")} disabled={busy != null} className="btn-ink px-5 py-3 disabled:opacity-50">
                    {busy === "suscripcion" ? "Abriendo Mercado Pago…" : "Pasarme a Piloto profesional"}
                  </button>
                  <span className="text-center text-[0.8rem] text-[#5b616b]">Cancelás cuando quieras</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="card flex flex-col gap-4 p-5">
            <PlanHead name="Ingeniero Pro" price={`desde ${pesos(Math.min(...packs.map((p) => Math.round(p.ars / p.carreras / 10) * 10)))}`} per="c/u" />
            <p className="text-[0.95rem] text-muted">Comprá la asistencia del ingeniero Pro para cualquiera de tus planes.</p>
            <div className="mt-auto flex flex-col gap-2">
              {packs.map((p, i) => {
                const best = i === packs.length - 1;
                return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void buy(p.id)}
                  disabled={busy != null}
                  className={`btn relative flex items-center justify-between gap-3 px-4 py-3 text-left disabled:opacity-50 ${best ? "mt-3 border-accent" : ""}`}
                >
                  {best && (
                    <span className="absolute -top-3 left-4 rounded-full bg-accent px-3 py-0.5 text-[0.72rem] font-semibold uppercase tracking-wider text-white">
                      La que más conviene
                    </span>
                  )}
                  <span>
                    <span className="block font-semibold">{p.carreras} carreras</span>
                    <span className="block text-[0.78rem] text-muted">
                      {pesos(Math.round(p.ars / p.carreras / 10) * 10)} cada una
                    </span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap font-mono">{busy === p.id ? "…" : pesos(p.ars)}</span>
                </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Short answers */}
      <section className="grid gap-5 border-t border-line pt-6 md:grid-cols-3">
        <Faq q="¿Qué cuenta como una carrera?">
          Cada vez que salís a pista y el ingeniero te habla: una práctica, una clasificación o una carrera de hasta {b.minutos_por_carrera} minutos. Menús y boxes no cuentan.
        </Faq>
        <Faq q="¿Y si se termina el ingeniero Pro?">
          Te sigue hablando la radio de avisos. Cuando sumás carreras, vuelve el Pro, incluso en plena carrera.
        </Faq>
        <Faq q="¿Cómo pago?">
          Con Mercado Pago, en pesos: tarjeta, débito o dinero en cuenta. Piloto profesional lo cancelás acá, cuando quieras.
        </Faq>
      </section>
      {/* What the Pro engineer is, before trying it */}
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="display text-[2rem] uppercase leading-none">¿Qué es el ingeniero Pro?</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[0.8rem] font-semibold uppercase tracking-wider text-accent-fg">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 12l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z" />
              </svg>
              Potenciado con IA
            </span>
          </div>
          <p className="text-[1.05rem] text-soft-fg">
            Tu ingeniero de pista, como el de un equipo de verdad. Mira la telemetría de tu auto vuelta a vuelta y te habla por radio
            mientras corrés: te arma la estrategia, te dice cuándo parar y dónde estás perdiendo tiempo. Y si tenés una duda, le preguntás.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {PRO_POINTS.map(([title, text]) => (
            <div key={title} className="card flex flex-col gap-1.5 p-4">
              <span className="title text-[1.05rem]">{title}</span>
              <p className="text-[0.92rem] text-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How each engineer sounds: the same real race, frozen; the Pro one answers live */}
      <section className="flex flex-col gap-4">
        <h2 className="display text-[2rem] uppercase leading-none">Ingeniero Pro, ¿vale la pena?</h2>
        <p className="text-muted">Una carrera real, en la vuelta 4 de 6 con lluvia. Escuchá la radio de avisos y preguntale al ingeniero Pro lo que quieras para ver la diferencia.</p>
        <EngineerDemo />
      </section>

      {/* Why connect it to the player's own AI, with the how-to */}
      <section className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="title text-[1.3rem]">Conectá tu IA y hacela tu analista de carreras</h2>
            <span className="rounded-full border border-line px-2.5 py-0.5 text-[0.75rem] text-soft-fg">Con Piloto profesional</span>
          </div>
          <p className="text-[0.95rem] text-muted">
            Sola, tu IA no sabe nada de cómo manejás. Conectada a Pit en línea, lee tu telemetría y la analiza con vos cuando no estás
            corriendo: repasa una carrera, te muestra cómo venís mejorando, compara tus vueltas y te ayuda a preparar el reglaje del
            próximo gran premio. Funciona con Claude y ChatGPT.
          </p>
        </div>
        <a href={AI_GUIDE_URL} target="_blank" rel="noopener" className="btn shrink-0 self-start whitespace-nowrap px-4 py-2.5 text-[0.95rem] sm:self-center">
          Cómo conectarla ›
        </a>
      </section>
    </main>
  );
}

/** What the current plan includes: the two engineers with what is left, then the rest. */
function Included({ b, radioLeft }: { b: Billing; radioLeft: number | null }) {
  const unlimited = b.plan === "cortesia" || !b.limites;
  const pool = b.pro;
  const ORIGIN = { regalo: "de regalo", plan: "del plan este mes", compradas: "compradas" } as const;
  const proFrom = (pool?.origen ?? []).map((o) => `${o.quedan} ${ORIGIN[o.tipo]}`);
  const radioTotal = b.avisos_mes.incluidas;
  const screens = b.puede.pantallas;
  const extras: [string, boolean][] = [
    ["Telemetría, reglaje y clasificaciones", true],
    [b.puede.mcp ? "Conexión con tu IA" : "Conexión con tu IA, con Piloto profesional", b.puede.mcp],
    [screens == null ? "Todas las pantallas que quieras" : `${screens} ${screens === 1 ? "pantalla vinculada" : "pantallas vinculadas"}`, screens == null || screens > 0],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Meter
        title="Ingeniero Pro"
        value={unlimited || !pool ? "∞" : String(pool.quedan)}
        unit={unlimited || !pool ? "sin límite" : pool.de ? `de ${pool.de}` : pool.quedan === 1 ? "carrera" : "carreras"}
        fill={!unlimited && pool?.de ? pool.quedan / pool.de : null}
        detail={unlimited || !pool ? "Te habla y le preguntás en todas tus carreras." : proFrom.length ? proFrom.join(" · ") : "Sumá carreras con un pack o con Piloto profesional."}
        empty={!unlimited && !pool?.quedan}
        pro
      />
      <Meter
        title="Radio de avisos"
        value={unlimited || radioLeft == null ? "∞" : String(radioLeft)}
        unit={unlimited || radioLeft == null ? "en todas tus carreras" : `de ${radioTotal} este mes`}
        fill={!unlimited && radioLeft != null && radioTotal ? radioLeft / radioTotal : null}
        detail="Cuando no tenés ingeniero Pro, te avisa lo importante."
        empty={!unlimited && radioLeft === 0}
      />
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[0.88rem] sm:col-span-2">
        {extras.map(([text, on]) => (
          <li key={text} className={`flex items-center gap-1.5 ${on ? "text-soft-fg" : "text-dim"}`}>
            <span aria-hidden className={on ? "text-ok" : ""}>{on ? "✓" : "+"}</span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Meter({ title, value, unit, detail, fill = null, empty, pro }: { title: string; value: string; unit: string; detail: string; fill?: number | null; empty?: boolean; pro?: boolean }) {
  return (
    <div className={`card flex flex-col gap-2 p-4 ${pro ? "ring-1 ring-accent" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="title text-[1.05rem]">{title}</span>
        {pro && <span className="rounded-full bg-accent px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-accent-fg">Pro</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`display text-[2.6rem] leading-none ${empty ? "text-dim" : ""}`}>{value}</span>
        <span className="text-[0.9rem] text-muted">{unit}</span>
      </div>
      {fill != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden>
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(fill * 100)}%` }} />
        </div>
      )}
      <p className="text-[0.82rem] text-dim">{detail}</p>
    </div>
  );
}

function PlanHead({ name, price, per, current, light }: { name: string; price: string; per?: string; current?: boolean; light?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="title text-[1.4rem]">{name}</span>
        {current && <span className={`rounded-full px-2.5 py-0.5 text-[0.72rem] font-semibold ${light ? "bg-black/10" : "bg-panel-2 text-muted"}`}>Tu plan</span>}
      </div>
      <span className="display mt-1 block text-[2.3rem] leading-none">
        {price}
        {per && <span className={`ml-1 text-[1rem] not-italic ${light ? "text-[#5b616b]" : "text-muted"}`}>{per}</span>}
      </span>
    </div>
  );
}

function Item({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span className={strong ? "font-semibold" : ""}>{children}</span>
    </li>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold">{q}</h3>
      <p className="mt-1 text-[0.92rem] text-muted">{children}</p>
    </div>
  );
}
