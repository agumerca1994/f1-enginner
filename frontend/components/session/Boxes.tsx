"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CornerThumb } from "@/components/ui/TrackOutline";
import { COMPOUND_ES, TyreDot } from "@/components/ui/Tyres";
import { academyEntry } from "@/lib/academy";
import type { SetupSuggestion } from "@/lib/box";
import { WEATHER_ES } from "@/lib/format";
import { dec, lapS, useApi, type RunReport } from "@/lib/sessions";
import type { EngineerMessage, Snapshot } from "@/lib/types";

const DONE_KEY = "cambios-hechos";

function settingName(param: string) {
  return academyEntry(param)?.title ?? param.replace(/_/g, " ");
}

function fmt(param: string, v: number) {
  const unit = academyEntry(param)?.unit;
  return `${Number.isInteger(v) ? v : dec(v, 1)}${unit === "%" ? "%" : ""}`;
}

/** Changes the player already made, so the next one comes up (kept per session on this device). */
function useDone(sid: number | null) {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(`${DONE_KEY}-${sid}`) || "[]"));
    } catch {}
  }, [sid]);
  const mark = (param: string) => {
    const next = [...done, param];
    setDone(next);
    try {
      localStorage.setItem(`${DONE_KEY}-${sid}`, JSON.stringify(next));
    } catch {}
  };
  return { done, mark };
}

/**
 * The box: the car is stopped and this is what to look at before going out again.
 * The last run and where its best lap lost time, the one setup change to try,
 * the weather coming and the tyres left.
 */
export function Boxes({ s, sid, messages }: { s: Snapshot; sid: number | null; messages: EngineerMessage[] }) {
  // Refetch when a lap completes, so coming back to the box shows the run just driven.
  const lapsKey = s.sector_review?.slice(-1)[0]?.lap ?? 0;
  const { data: report, loading } = useApi<RunReport | null>(sid != null ? `/api/sessions/${sid}/report` : null, lapsKey);
  const { done, mark } = useDone(sid);
  const plan = [...messages].reverse().find((m) => m.estrategia?.plan)?.estrategia?.plan;

  const todo = (report?.sugerencias_reglaje ?? []).filter((x) => !done.includes(x.parametro));
  const next = todo[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_330px]">
      <section className="flex min-w-0 flex-col gap-3" aria-label="Tu última tanda">
        {report ? <RunHero report={report} position={s.lap?.position} /> : <NoRun loading={loading && sid != null} />}
        {report && report.perdidas.length > 0 && (
          <>
            <h2 className="eyebrow mt-2">Dónde se te fue el tiempo</h2>
            {report.perdidas.map((l) => (
              <Link
                key={l.curva}
                href={`/box?s=${sid}`}
                className="card grid grid-cols-[72px_1fr_auto] items-center gap-3 px-3 py-3 hover:bg-panel-2 sm:grid-cols-[96px_1fr_auto] sm:gap-4"
              >
                <CornerThumb trackId={s.track?.id} corner={l.curva} corners={s.track?.corners} className="h-12 w-[72px] sm:h-16 sm:w-24" />
                <span className="min-w-0">
                  <span className="title block text-[1.35rem] sm:text-[1.5rem]">Curva {l.curva}</span>
                  <span className="mt-0.5 block text-[0.92rem] leading-snug text-soft-fg">{l.texto}</span>
                </span>
                <span className="text-right">
                  <span className="display block text-[1.5rem] whitespace-nowrap text-accent-ink sm:text-[1.8rem]">−{dec(l.perdida_s)}</span>
                  <span className="text-[0.8rem] whitespace-nowrap text-accent-ink">Ver la vuelta ›</span>
                </span>
              </Link>
            ))}
          </>
        )}
        {report && (
          <Link href={`/box?s=${sid}`} className="btn mt-1 flex items-center justify-between px-4 py-3 text-[0.95rem]">
            <span>Toda la telemetría: velocidad, acelerador, freno y marcha, vuelta contra vuelta</span>
            <span aria-hidden="true">›</span>
          </Link>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-3" aria-label="Para la próxima tanda">
        <h2 className="eyebrow">Para la próxima tanda</h2>
        {next ? (
          <NextChange x={next} sid={sid} onDone={() => mark(next.parametro)} />
        ) : (
          <div className="card px-4 py-4 text-[0.95rem] text-soft-fg">
            {report ? "No aparece ningún problema repetido que pida tocar el reglaje. Seguí girando." : "Cuando hagas una tanda te digo qué tocar."}
          </div>
        )}
        {todo.length > 1 && (
          <div className="card flex flex-col gap-2.5 px-4 py-3.5">
            <span className="text-[0.85rem] text-dim">Después, si hace falta</span>
            {todo.slice(1).map((x) => (
              <Link key={x.parametro} href={`/reglaje?s=${sid}&p=${x.parametro}`} className="flex items-baseline justify-between gap-3 text-[0.95rem]">
                <span>{settingName(x.parametro)}</span>
                <span className="title num text-[1.1rem] whitespace-nowrap">{fmt(x.parametro, x.valor_actual)} → {fmt(x.parametro, x.valor_sugerido)}</span>
              </Link>
            ))}
          </div>
        )}
        {report?.conduccion.slice(0, 2).map((d) => (
          <div key={d.curva} className="card flex items-start gap-3 px-4 py-3.5">
            <span className="shrink-0 rounded border border-warn/40 px-1.5 py-0.5 font-mono text-[0.65rem] text-warn">MANEJO</span>
            <span className="text-[0.92rem] leading-snug text-soft-fg">{d.texto}</span>
          </div>
        ))}
        <Link href={`/reglaje${sid ? `?s=${sid}` : ""}`} className="text-[0.92rem] text-accent-ink">
          Ver el reglaje completo, con el auto en 3D ›
        </Link>
      </section>

      <aside className="flex min-w-0 flex-col gap-3" aria-label="Condiciones">
        <WeatherCard s={s} />
        <TyreSets s={s} />
        {plan && (
          <div className="card px-4 py-4">
            <h2 className="eyebrow">El plan</h2>
            <p className="mt-2 text-[0.92rem] leading-snug text-soft-fg">{plan}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function NoRun({ loading }: { loading: boolean }) {
  return (
    <div className="card px-5 py-5">
      <span className="eyebrow">Tu tanda</span>
      <p className="mt-2 text-[1rem] text-soft-fg">
        {loading ? "Buscando tus vueltas…" : "Todavía no diste vueltas en esta sesión. Salí a pista: cuando vuelvas te muestro cómo te fue y qué tocar."}
      </p>
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className={`display text-[1.9rem] whitespace-nowrap not-italic sm:text-[2.2rem] ${tone ?? ""}`}>{value}</div>
      <div className="mt-1 text-[0.82rem] leading-tight text-dim">{label}</div>
    </div>
  );
}

function RunHero({ report, position }: { report: RunReport; position?: number }) {
  const gapToBest = report.mas_rapido_s != null && report.mejor_vuelta_s != null ? report.mejor_vuelta_s - report.mas_rapido_s : null;
  const diff = report.contra_tanda_anterior?.mejor_vuelta_diferencia_s;
  return (
    <div className="card flex flex-col gap-4 px-5 py-4">
      <span className="eyebrow flex flex-wrap items-center gap-x-2">
        Tu tanda {report.tanda} · {report.vueltas.length} {report.vueltas.length === 1 ? "vuelta" : "vueltas"}
        {report.compuesto && (
          <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
            · <TyreDot compound={report.compuesto} filled size={12} /> {COMPOUND_ES[report.compuesto] ?? report.compuesto}
          </span>
        )}
      </span>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <div className="display text-[3.2rem] sm:text-[4.2rem]">{lapS(report.mejor_vuelta_s)}</div>
          <div className="mt-1 text-[0.82rem] text-dim">tu mejor vuelta</div>
        </div>
        <div className="flex gap-7">
          {position != null && <Stat value={`P${position}`} label="en la sesión" />}
          {gapToBest != null && gapToBest > 0.005 && <Stat value={`+${dec(gapToBest)}`} label="al más rápido" tone="text-warn" />}
          {diff != null && <Stat value={`${diff < 0 ? "−" : "+"}${dec(Math.abs(diff))}`} label="contra tu tanda anterior" tone={diff < 0 ? "text-ok" : "text-warn"} />}
        </div>
      </div>
      <ol className="flex flex-wrap gap-1.5 border-t border-panel-2 pt-3" aria-label="Tus vueltas de esta tanda">
        {report.vueltas.map((v) => (
          <li
            key={v.vuelta}
            className={`flex items-baseline gap-2 rounded-[8px] px-2.5 py-1.5 ${v.mejor ? "bg-best/15 ring-1 ring-best/60" : "bg-bg"}`}
            title={v.valida ? undefined : "Vuelta invalidada"}
          >
            <span className="font-mono text-[0.7rem] text-dim">V{v.vuelta}</span>
            <span className={`title num text-[1rem] normal-case ${v.mejor ? "text-best" : v.valida ? "" : "text-dim line-through"}`}>{lapS(v.tiempo_s)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function NextChange({ x, sid, onDone }: { x: SetupSuggestion; sid: number | null; onDone: () => void }) {
  return (
    <div className="paper flex flex-col gap-3 px-5 py-5">
      <span className="text-[0.85rem] text-paper-muted">Un cambio por vez, así sabés si sirvió</span>
      <span className="title text-[1.7rem] sm:text-[2rem]">{settingName(x.parametro)}</span>
      <span className="display flex items-baseline gap-3 not-italic">
        <span className="text-[2.6rem] text-[#6b717c] sm:text-[3.2rem]">{fmt(x.parametro, x.valor_actual)}</span>
        <span className="text-[1.6rem] text-[#6b717c]">→</span>
        <span className="text-[2.6rem] text-[#d92b14] sm:text-[3.2rem]">{fmt(x.parametro, x.valor_sugerido)}</span>
      </span>
      <p className="text-[0.95rem] leading-snug text-[#2a2e35]">
        {x.problema} ({x.evidencia}). {x.efecto}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="btn-ink h-11 flex-1 text-[1rem]">
          Lo cambié
        </button>
        <Link href={`/reglaje?s=${sid ?? ""}&p=${x.parametro}`} className="grid h-11 place-items-center rounded-[var(--radius-control)] border border-[#c4c8ce] px-4 text-[0.92rem]">
          Ver en el auto
        </Link>
      </div>
    </div>
  );
}

function WeatherCard({ s }: { s: Snapshot }) {
  const ses = s.session;
  if (!ses) return null;
  return (
    <div className="card px-4 py-4">
      <h2 className="eyebrow">Clima</h2>
      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="title text-[1.5rem]">{WEATHER_ES[ses.weather] ?? ses.weather}</span>
        <span className="text-[0.85rem] whitespace-nowrap text-muted">pista {ses.track_temperature_c}° · aire {ses.air_temperature_c}°</span>
      </div>
      {ses.forecast.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
          {ses.forecast.slice(0, 4).map((f) => (
            <div key={f.in_minutes} className="rounded-[8px] bg-bg px-1 py-2">
              <div className="text-[0.72rem] text-dim">{f.in_minutes ? `+${f.in_minutes} min` : "ahora"}</div>
              <div className={`display text-[1.25rem] not-italic ${f.rain_percent >= 40 ? "text-info" : "text-muted"}`}>{f.rain_percent}%</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TyreSets({ s }: { s: Snapshot }) {
  const sets = s.tyre_sets;
  if (!sets?.length) return null;
  return (
    <div className="card flex flex-col gap-2.5 px-4 py-4">
      <h2 className="eyebrow">Gomas que te quedan</h2>
      {sets.map((t, i) => (
        <div key={i} className="flex items-center gap-2.5 text-[0.95rem]">
          <TyreDot compound={t.compound} filled={t.fitted || !t.new} size={15} />
          <span className="flex-1">{COMPOUND_ES[t.compound] ?? t.compound}</span>
          <span className="text-[0.85rem] text-muted">
            {t.fitted ? `puestas · ${t.wear_percent}% gastadas` : t.new ? `${t.count} ${t.count === 1 ? "nuevo" : "nuevos"}` : `${t.count} ${t.count === 1 ? "usado" : "usados"} · ${t.wear_percent}%`}
          </span>
        </div>
      ))}
    </div>
  );
}
