"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { sessionName } from "@/components/dashboard/Cards";
import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Bucket = { calls: number; cost_usd: number; input_tokens: number; output_tokens: number; cache_read_tokens: number };
type Usage = {
  today: Bucket;
  month: Bucket;
  total: { calls: number; cost_usd: number };
  free_answers: number;
  average_cost_per_call: number | null;
  by_day: ({ date: string } & Bucket)[];
  by_session: ({ game_session_id: number | null; track: string | null; session_type: string | null; started_at: string | null; modes: string[] } & Bucket)[];
  by_model: ({ model: string; avg_latency_ms: number | null } & Bucket)[];
  provider_now: string;
};

export default function UsagePage() {
  return (
    <RequireAuth>
      <UsageView />
    </RequireAuth>
  );
}

const usd = (v: number) => `US$ ${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;
const tokens = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)} M` : v >= 1000 ? `${(v / 1000).toFixed(1)} k` : `${v}`);
const MODE_ES: Record<string, string> = { live: "En vivo", replay: "Repetición" };

function UsageView() {
  const { credentials } = useAuth();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const offset = -new Date().getTimezoneOffset();
        setUsage(await api<Usage>(`/api/engineer/usage?days=30&tz_offset_minutes=${offset}`, await credentials()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      }
    })();
  }, [credentials]);

  const maxDay = Math.max(0.0001, ...(usage?.by_day.map((d) => d.cost_usd) ?? [0]));

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Consumo de IA</h1>
        <Link href="/" className="text-sm text-accent underline">
          Volver al dashboard
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">
        Lo que usó el ingeniero de pista con IA. Los avisos por reglas y los inmediatos no tienen costo.
        {usage && <> Hoy responde: <span className="text-fg">{usage.provider_now === "reglas" ? "reglas (sin IA)" : usage.provider_now}</span>.</>}
      </p>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {!usage && !error && <p className="mt-8 text-muted">Cargando…</p>}

      {usage && (
        <>
          <section className="mt-6 grid gap-3 sm:grid-cols-3">
            <Tile title="Hoy" b={usage.today} />
            <Tile title="Este mes" b={usage.month} highlight />
            <div className="rounded-2xl border border-line bg-panel p-4">
              <div className="label">Total histórico</div>
              <div className="num mt-1 text-3xl font-semibold">{usd(usage.total.cost_usd)}</div>
              <div className="mt-1 text-sm text-muted">{usage.total.calls} llamadas a la IA</div>
              {usage.average_cost_per_call != null && (
                <div className="text-sm text-muted">Promedio {usd(usage.average_cost_per_call)} por llamada</div>
              )}
              <div className="text-sm text-muted">{usage.free_answers} respuestas sin costo</div>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
            <h2 className="label">Gasto por día · últimos 30 días</h2>
            <div className="mt-4 flex h-36 items-end gap-1">
              {usage.by_day.map((d) => (
                <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div
                    className={`w-full rounded-t ${d.cost_usd > 0 ? "bg-accent" : "bg-panel-2"}`}
                    style={{ height: `${d.cost_usd > 0 ? Math.max(4, (d.cost_usd / maxDay) * 100) : 2}%` }}
                    title={`${d.date}: ${usd(d.cost_usd)} · ${d.calls} llamadas`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[0.65rem] text-muted">
              <span>{usage.by_day[0]?.date.slice(5)}</span>
              <span>hoy</span>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
            <h2 className="label">Por sesión</h2>
            {usage.by_session.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Todavía no hay consumo de IA en los últimos 30 días.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="pb-2 font-normal">Sesión</th>
                      <th className="pb-2 font-normal">Modo</th>
                      <th className="pb-2 text-right font-normal">Llamadas</th>
                      <th className="pb-2 text-right font-normal">Tokens</th>
                      <th className="pb-2 text-right font-normal">Costo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {usage.by_session.map((s) => (
                      <tr key={s.game_session_id ?? "none"}>
                        <td className="py-2">
                          <div>{s.track ?? "Sesión"}</div>
                          <div className="text-xs text-muted">
                            {s.session_type ? sessionName(s.session_type) : ""}
                            {s.started_at && ` · ${new Date(s.started_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", hour12: false })}`}
                            {s.game_session_id != null && (
                              <>
                                {" · "}
                                <Link className="text-accent underline" href={`/replay/${s.game_session_id}`}>
                                  repetición
                                </Link>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-2 text-muted">{s.modes.map((m) => MODE_ES[m] ?? m).join(", ")}</td>
                        <td className="num py-2 text-right">{s.calls}</td>
                        <td className="num py-2 text-right text-muted">{tokens(s.input_tokens + s.output_tokens + s.cache_read_tokens)}</td>
                        <td className="num py-2 text-right font-semibold">{usd(s.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
            <h2 className="label">Por modelo</h2>
            {usage.by_model.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Sin llamadas a modelos todavía.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="pb-2 font-normal">Modelo</th>
                      <th className="pb-2 text-right font-normal">Llamadas</th>
                      <th className="pb-2 text-right font-normal">Entrada</th>
                      <th className="pb-2 text-right font-normal">Caché</th>
                      <th className="pb-2 text-right font-normal">Salida</th>
                      <th className="pb-2 text-right font-normal">Demora prom.</th>
                      <th className="pb-2 text-right font-normal">Costo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {usage.by_model.map((m) => (
                      <tr key={m.model}>
                        <td className="py-2">{m.model}</td>
                        <td className="num py-2 text-right">{m.calls}</td>
                        <td className="num py-2 text-right text-muted">{tokens(m.input_tokens)}</td>
                        <td className="num py-2 text-right text-muted">{tokens(m.cache_read_tokens)}</td>
                        <td className="num py-2 text-right text-muted">{tokens(m.output_tokens)}</td>
                        <td className="num py-2 text-right text-muted">{m.avg_latency_ms != null ? `${(m.avg_latency_ms / 1000).toFixed(1)} s` : "—"}</td>
                        <td className="num py-2 text-right font-semibold">{usd(m.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              El costo se calcula con los precios públicos de Anthropic por token. La caché reutiliza el manual del ingeniero entre llamadas y
              cuesta un 10 % de la entrada normal. El monto facturado final lo ves en la consola de Anthropic.
            </p>
          </section>
        </>
      )}
    </main>
  );
}

function Tile({ title, b, highlight = false }: { title: string; b: Bucket; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-panel p-4 ${highlight ? "border-accent/50" : "border-line"}`}>
      <div className="label">{title}</div>
      <div className="num mt-1 text-3xl font-semibold">{usd(b.cost_usd)}</div>
      <div className="mt-1 text-sm text-muted">{b.calls} llamadas a la IA</div>
      <div className="text-sm text-muted">
        {tokens(b.input_tokens + b.cache_read_tokens)} tokens de entrada · {tokens(b.output_tokens)} de salida
      </div>
    </div>
  );
}
