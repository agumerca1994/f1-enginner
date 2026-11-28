"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PLAN_NAMES, proRaces, type Billing, type Product } from "@/lib/billing";
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
        setNote(r.estado === "aprobado" ? "Listo, ya tenés tus carreras Pro." : "Mercado Pago todavía no confirmó el pago. Puede tardar unos minutos; esta pantalla se actualiza sola.");
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
    if (!confirm("¿Cancelar la Temporada? La seguís usando hasta el final del mes que pagaste.")) return;
    await api("/api/billing/cancel", await credentials(), { method: "POST" });
    setRev((x) => x + 1);
  };

  if (!b) return <main className="mx-auto max-w-[1000px] px-4 pt-6"><LoadingScreen /></main>;
  const season = b.productos.find((p) => p.id === "suscripcion")!;
  const packs = b.productos.filter((p) => p.id !== "suscripcion");
  const pro = proRaces(b);
  const radioLeft = b.avisos_mes.incluidas == null ? null : Math.max(0, b.avisos_mes.incluidas - b.avisos_mes.usadas);
  const inSeason = b.plan === "suscripcion";

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
            {inSeason && b.hasta && (
              <p className="mt-1 text-[0.9rem] text-dim">
                {b.renovacion === "cancelled" ? `Termina el ${shortDate(b.hasta)}.` : `Se renueva sola cerca del ${shortDate(b.hasta)}.`}
              </p>
            )}
          </div>
          {b.plan !== "cortesia" && b.limites && (
            <div className="flex gap-3">
              <Counter label="Ingeniero Pro" value={pro ?? 0} />
              <Counter label="Radio de avisos" value={radioLeft} sub={radioLeft == null ? "sin límite" : "este mes"} />
            </div>
          )}
        </div>
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
              <Item strong>{b.prueba_inicial} carreras con el ingeniero Pro, de regalo</Item>
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
              <Item strong>{b.carreras_por_mes} carreras Pro todos los meses</Item>
              <Item>Radio de avisos en todas tus carreras</Item>
              <Item>Tus sesiones en Claude y ChatGPT</Item>
              <Item>Todas las pantallas que quieras</Item>
            </ul>
            <div className="mt-auto flex flex-col gap-2">
              {inSeason ? (
                b.renovacion !== "cancelled" ? (
                  <button type="button" onClick={() => void cancel()} className="self-start text-[0.85rem] text-[#5b616b] underline">Cancelar la Temporada</button>
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
        <Faq q="¿Y si me quedo sin carreras Pro?">
          Te sigue hablando la radio de avisos. Cuando cargás más, vuelve el ingeniero Pro, incluso en medio de la carrera.
        </Faq>
        <Faq q="¿Cómo pago?">
          Con Mercado Pago, en pesos: tarjeta, débito o dinero en cuenta. La Temporada se cancela desde esta pantalla.
        </Faq>
      </section>
      {/* How each engineer sounds: the same real race, frozen; the Pro one answers live */}
      <section className="flex flex-col gap-4">
        <h2 className="display text-[2rem] uppercase leading-none">Ingeniero Pro, ¿vale la pena?</h2>
        <p className="text-muted">Una carrera real, en la vuelta 4 de 6 con lluvia. Escuchá la radio de avisos y preguntale al ingeniero Pro lo que quieras para ver la diferencia.</p>
        <EngineerDemo />
      </section>
    </main>
  );
}

function Counter({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div className="card min-w-[8.5rem] px-4 py-3">
      <span className="eyebrow">{label}</span>
      <div className="display text-[2.6rem] leading-none">{value == null ? "∞" : value}</div>
      <span className="text-[0.78rem] text-dim">{sub ?? (value === 1 ? "carrera" : "carreras")}</span>
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
