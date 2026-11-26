"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { proRaces, type Billing, type Product } from "@/lib/billing";
import { shortDate, useApi } from "@/lib/sessions";

export default function PlansPage() {
  return (
    <RequireAuth>
      <Plans />
    </RequireAuth>
  );
}

const pesos = (n: number) => `$ ${n.toLocaleString("es-AR")}`;
const PLAN_NAME = { gratis: "Plan gratis", suscripcion: "Suscripción", cortesia: "Plan de cortesía" };

/** The plan: what the account has, its AI races, and the two ways to pay (subscription or a race pack). */
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
    const ref = q.get("ref");
    if (!ref) return;
    const simulated = q.get("simulado") === "1";
    setBack({ ref, simulated });
    if (simulated) return;
    (async () => {
      try {
        const r = await api<{ estado: string }>(`/api/billing/sync?ref=${encodeURIComponent(ref)}`, await credentials(), { method: "POST" });
        setNote(r.estado === "aprobado" ? "Listo, el pago entró." : "Mercado Pago todavía no confirmó el pago. Puede tardar unos minutos; esta pantalla se actualiza sola.");
        setRev((x) => x + 1);
      } catch {
        setNote("No pudimos revisar el pago ahora. Si pagaste, se acredita solo en unos minutos.");
      }
      window.history.replaceState(null, "", "/planes");
    })();
  }, [credentials]);

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
    if (!confirm("¿Cancelar la renovación? Seguís con la suscripción hasta el final del mes pagado.")) return;
    await api("/api/billing/cancel", await credentials(), { method: "POST" });
    setRev((x) => x + 1);
  };

  if (!b) return <main className="mx-auto max-w-[900px] px-4 pt-6 text-muted">Cargando…</main>;
  const sub = b.productos.find((p) => p.id === "suscripcion")!;
  const packs = b.productos.filter((p) => p.id !== "suscripcion");
  const pro = proRaces(b);
  const radio = b.avisos_mes;

  return (
    <main className="mx-auto flex max-w-[1000px] flex-col gap-5 px-[max(1rem,env(safe-area-inset-left))] py-5 lg:py-8">
      <Link href="/settings" className="text-[0.9rem] text-muted">‹ Ajustes</Link>

      {back?.simulated && (
        <section className="paper flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <span>Pagos de prueba: no hay Mercado Pago configurado en este entorno.</span>
          <button type="button" onClick={() => void simulate()} className="btn-ink px-4 py-2">Simular pago aprobado</button>
        </section>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">Tu plan</span>
          <h1 className="display mt-1 text-[3rem] uppercase leading-[0.9]">{PLAN_NAME[b.plan]}</h1>
          {b.hasta && b.plan !== "gratis" && (
            <p className="mt-2 text-muted">
              {b.plan === "suscripcion" ? (b.renovacion === "cancelled" ? "Activa hasta el " : "Se renueva cerca del ") : "Hasta el "}
              {shortDate(b.hasta)}
            </p>
          )}
          {b.plan === "cortesia" && !b.hasta && <p className="mt-2 text-muted">Todo incluido, sin vencimiento.</p>}
        </div>
        <div className="flex flex-wrap gap-6">
          <div>
            <span className="eyebrow">Ingeniero Pro</span>
            <div className="display text-[2.6rem]">{pro == null ? "∞" : pro}</div>
            {b.prueba > 0 && b.plan !== "cortesia" && <span className="text-[0.8rem] text-muted">{b.prueba} de regalo</span>}
          </div>
          <div>
            <span className="eyebrow">Radio de avisos</span>
            <div className="display text-[2.6rem]">{radio.incluidas == null ? "∞" : Math.max(0, radio.incluidas - radio.usadas)}</div>
            {radio.incluidas != null && <span className="text-[0.8rem] text-muted">de {radio.incluidas} este mes</span>}
          </div>
          {b.plan === "suscripcion" && (
            <div>
              <span className="eyebrow">Pro del mes</span>
              <div className="display text-[2.6rem]">{b.carreras_mes.usadas}/{b.carreras_mes.incluidas}</div>
            </div>
          )}
        </div>
      </header>
      {note && <p className="paper px-4 py-3 text-[0.95rem]">{note}</p>}
      {!b.limites && <p className="text-[0.85rem] text-dim">Durante la beta todo está incluido para todos.</p>}

      <section className="grid gap-4 lg:grid-cols-3">
        <div className={`card flex flex-col gap-3 p-5 ${b.plan === "gratis" ? "ring-1 ring-line" : ""}`}>
          <span className="title text-[1.3rem]">Gratis</span>
          <span className="display text-[2.2rem]">$ 0</span>
          <ul className="flex flex-col gap-1.5 text-[0.92rem] text-muted">
            <li><b className="text-fg">{b.prueba_inicial} carreras con el ingeniero Pro</b> de regalo para probarlo</li>
            <li>Radio de avisos en {b.avisos_por_mes} carreras por mes</li>
            <li>Historial, telemetría y comparación de vueltas</li>
            <li>Reglaje sugerido y lo aprendido por pista</li>
            <li>Clasificaciones, grupos y tarjeta para compartir</li>
            <li>1 pantalla vinculada</li>
          </ul>
        </div>

        <div className="paper flex flex-col gap-3 p-5">
          <span className="title text-[1.3rem]">Suscripción</span>
          <span className="display text-[2.2rem]">{pesos(sub.ars)}<span className="text-[1rem] not-italic text-[#5b616b]"> /mes</span></span>
          <ul className="flex flex-col gap-1.5 text-[0.92rem]">
            <li><b>{b.carreras_por_mes} carreras por mes con el ingeniero Pro</b></li>
            <li>Radio de avisos sin límite</li>
            <li>Todo lo del plan gratis</li>
            <li>Conector con Claude (MCP) para analizar tus sesiones</li>
            <li>Pantallas vinculadas sin límite</li>
          </ul>
          {b.plan === "suscripcion" ? (
            b.renovacion !== "cancelled" ? (
              <button type="button" onClick={() => void cancel()} className="mt-auto self-start text-[0.85rem] text-[#5b616b] underline">Cancelar la renovación</button>
            ) : (
              <span className="mt-auto text-[0.85rem] text-[#5b616b]">Renovación cancelada</span>
            )
          ) : b.plan === "gratis" ? (
            <button type="button" onClick={() => void buy("suscripcion")} disabled={busy != null} className="btn-ink mt-auto px-5 py-3 disabled:opacity-50">
              {busy === "suscripcion" ? "Abriendo Mercado Pago…" : "Suscribirme"}
            </button>
          ) : null}
        </div>

        <div className="card flex flex-col gap-3 p-5">
          <span className="title text-[1.3rem]">Carreras Pro</span>
          <p className="text-[0.92rem] text-muted">
            El ingeniero Pro cuando quieras, sin suscripción. Se suman a las del plan y no vencen.
          </p>
          <div className="mt-auto flex flex-col gap-2">
            {packs.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void buy(p.id)}
                disabled={busy != null}
                className="btn flex items-center justify-between px-4 py-3 disabled:opacity-50"
              >
                <span>{p.carreras} carreras</span>
                <span className="font-mono">{busy === p.id ? "…" : pesos(p.ars)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card flex flex-col gap-2 p-5">
          <span className="eyebrow">Radio de avisos</span>
          <p className="text-[0.92rem] text-muted">
            Te avisa lo importante en frases cortas: safety car y si conviene parar, pinchazos y daños, lluvia que llega, sanciones, combustible y gomas.
          </p>
        </div>
        <div className="paper flex flex-col gap-2 p-5">
          <span className="eyebrow">Ingeniero Pro</span>
          <p className="text-[0.92rem]">
            Un ingeniero de verdad: le hablás y te responde lo que le preguntás, arma la estrategia en la largada y la ajusta, decide cuando se juntan daño, gomas y safety car, te guía curva por curva y se acuerda de lo que hablaron en el fin de semana.
          </p>
        </div>
      </section>

      <p className="text-[0.8rem] text-dim">
        Pagás con Mercado Pago, en pesos. Una carrera es una sesión de hasta {b.minutos_por_carrera} minutos y se descuenta recién cuando el ingeniero habla en ella. Si no te quedan carreras Pro, habla la radio de avisos.
      </p>
    </main>
  );
}
