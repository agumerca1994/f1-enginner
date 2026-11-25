"use client";

import type { CSSProperties, ReactNode } from "react";

import { shortName } from "@/components/dashboard/Cards";
import { isRace, signedSecs } from "@/components/live/LiveBlocks";
import { CarTyres, TyreDot, tyreColor } from "@/components/ui/Tyres";
import { TrackOutline } from "@/components/ui/TrackOutline";
import { sizeLevel, type Piece, type PieceKind } from "@/lib/cockpit";
import { lapTime, WEATHER_ES } from "@/lib/format";
import { teamColor } from "@/lib/teams";
import type { CarRow, EngineerMessage, Snapshot } from "@/lib/types";

const ERS_MODE_ES: Record<string, string> = { None: "recarga", Medium: "normal", Hotlap: "vuelta rápida", Overtake: "adelantamiento" };
const FUEL_MIX_ES: Record<string, string> = { Lean: "pobre", Standard: "estándar", Rich: "rica", Max: "máxima" };
const LED_COLORS = [...Array(5).fill("var(--color-ok)"), ...Array(5).fill("var(--color-accent)"), ...Array(5).fill("#7c8cff")];

export type PieceContext = { s: Snapshot | null; messages?: EngineerMessage[]; talk?: ReactNode };

/** Sizes in container units: a piece's text grows with the piece, whatever the screen. */
const fs = (cqh: number, cqw: number): CSSProperties => ({ fontSize: `min(${cqh}cqh, ${cqw}cqw)` });

function Label({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`eyebrow block truncate ${tone ?? ""}`}>{children}</span>;
}

function Empty() {
  return <span className="display text-dim" style={fs(40, 30)}>—</span>;
}

const dec = (v: number, d = 1) => v.toFixed(d).replace(".", ",");

function player(s: Snapshot | null): CarRow | undefined {
  return s?.cars?.find((c) => c.is_player);
}

/** Whether a piece has something the driver must see now; it then lights up. */
export function urgent(kind: PieceKind, s: Snapshot | null): boolean {
  if (!s) return false;
  switch (kind) {
    case "rivales": {
      const b = s.relatives?.behind[0];
      return !!b && b.gap_s != null && b.gap_s < 0.5 && !b.pit && b.relation == null;
    }
    case "gomas": {
      const t = s.car?.tyres_surface_temperature_c;
      const w = s.damage?.tyres_wear_percent;
      return (!!t && Math.max(t.front_left, t.front_right, t.rear_left, t.rear_right) > 110) || (!!w && Math.max(w.front_left, w.front_right, w.rear_left, w.rear_right) > 70);
    }
    case "combustible":
      return !!s.status && s.status.fuel_remaining_laps < -0.2;
    case "danos": {
      const d = s.damage;
      return !!d && Math.max(d.front_left_wing, d.front_right_wing, d.rear_wing, d.floor, d.engine, d.gearbox) >= 30;
    }
    case "energia":
      return !!s.status && s.status.ers_percent < 10;
    default:
      return false;
  }
}

export function PieceBody({ piece, ctx }: { piece: Pick<Piece, "kind" | "w" | "h">; ctx: PieceContext }) {
  const level = sizeLevel(piece);
  const { s } = ctx;
  switch (piece.kind) {
    case "marcha":
      return <Gear s={s} level={level} />;
    case "luces":
      return <Lights s={s} />;
    case "delta":
      return <Delta s={s} level={level} />;
    case "tiempos":
      return <Times s={s} level={level} />;
    case "posicion":
      return <Position s={s} level={level} />;
    case "rivales":
      return <Around s={s} level={level} rows={piece.h >= 4 ? 7 : piece.h >= 3 ? 5 : 0} />;
    case "tabla":
      return <Standings s={s} level={level} rows={Math.max(4, piece.h * 3)} />;
    case "mapa":
      return <MapPiece s={s} level={level} />;
    case "gomas":
      return <TyresPiece s={s} level={level} />;
    case "energia":
      return <Energy s={s} level={level} />;
    case "combustible":
      return <Fuel s={s} level={level} />;
    case "danos":
      return <Damage s={s} level={level} />;
    case "clima":
      return <Weather s={s} level={level} />;
    case "pedales":
      return <Pedals s={s} />;
    case "radio":
      return <Radio messages={ctx.messages ?? []} level={level} talk={ctx.talk} />;
    case "aero":
      return <Aero s={s} />;
  }
}

function Gear({ s, level }: { s: Snapshot | null; level: number }) {
  const car = s?.car;
  const gear = car == null ? "–" : car.gear === 0 ? "N" : car.gear < 0 ? "R" : String(car.gear);
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <span className="display" style={fs(level ? 62 : 85, 80)}>{gear}</span>
      {level >= 1 && <span className="display mt-[4cqh] font-bold not-italic" style={fs(16, 22)}>{car ? Math.round(car.speed_kmh) : "—"}</span>}
      {level >= 1 && <span className="eyebrow">km/h</span>}
      {level >= 2 && <span className="num mt-[2cqh] text-muted" style={fs(8, 12)}>{car ? car.rpm.toLocaleString("es-AR") : "—"} rpm</span>}
    </div>
  );
}

function Lights({ s }: { s: Snapshot | null }) {
  const lit = Math.round(((s?.car?.rev_lights_percent ?? 0) / 100) * LED_COLORS.length);
  return (
    <div className="flex h-full items-center gap-[0.6%]" role="img" aria-label={`Luces de cambio: ${lit} de 15`}>
      {LED_COLORS.map((c, i) => (
        <span key={i} className="h-[55%] flex-1 rounded-[4px]" style={{ background: i < lit ? c : "var(--color-panel-2)", boxShadow: i < lit ? `0 0 10px ${c}` : undefined }} />
      ))}
    </div>
  );
}

function deltaTone(ms: number | null | undefined): string {
  if (ms == null) return "text-dim";
  return ms > 50 ? "text-warn" : ms < -50 ? "text-ok" : "text-fg";
}

function Delta({ s, level }: { s: Snapshot | null; level: number }) {
  const d = s?.lap?.delta_best_ms ?? null;
  const best = player(s)?.best_lap_ms;
  const pct = d == null ? 0 : Math.min(50, (Math.abs(d) / 2000) * 50);
  const review = s?.sector_review?.slice(-1)[0];
  if (level === 0)
    return (
      <div className="grid h-full place-items-center">
        <span className={`display ${deltaTone(d)}`} style={fs(70, 30)}>{d == null ? "—" : signedSecs(d)}</span>
      </div>
    );
  const main = (
    <div className="flex h-full min-w-0 flex-col justify-between">
      <div className="flex justify-between gap-2">
        <Label>Vs tu mejor vuelta</Label>
        {s?.lap && <span className="eyebrow">sector {s.lap.sector}</span>}
      </div>
      {d == null ? (
        <span className="text-[min(9cqh,3.6cqw)] leading-snug text-dim">Todavía sin vuelta de referencia: aparece al completar una vuelta limpia.</span>
      ) : (
        <span className={`display ${deltaTone(d)}`} style={fs(46, level === 2 ? 30 : 26)}>{signedSecs(d)}</span>
      )}
      <div className="relative h-2 rounded bg-panel-2" aria-hidden="true">
        <span className="absolute top-[-3px] left-1/2 h-3.5 w-0.5 bg-fg" />
        {d != null && <span className={`absolute top-0 h-2 ${d < 0 ? "right-1/2 rounded-l bg-ok" : "left-1/2 rounded-r bg-warn"}`} style={{ width: `${pct}%` }} />}
      </div>
      <span className="title num text-[min(15cqh,7cqw)] font-bold normal-case">
        {lapTime(s?.lap?.current_lap_ms)} {best ? <span className="text-dim">· mejor {lapTime(best)}</span> : null}
      </span>
    </div>
  );
  if (level < 2) return main;
  return (
    <div className="grid h-full grid-cols-2 gap-[4cqw]">
      {main}
      <div className="flex flex-col justify-center gap-[5cqh]">
        <Label>Tu última vuelta, por sector</Label>
        {[0, 1, 2].map((i) => {
          const v = review?.sector_deltas_ms?.[i];
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="eyebrow w-6">S{i + 1}</span>
              <span className={`flex h-[16cqh] flex-1 items-center rounded px-2 text-[min(9cqh,4cqw)] ${v == null ? "bg-panel-2 text-dim" : v < 0 ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>
                {v == null ? "—" : signedSecs(v)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Times({ s, level }: { s: Snapshot | null; level: number }) {
  const lap = s?.lap;
  const best = player(s)?.best_lap_ms;
  const sectors = [lap?.sector1_ms ?? null, lap?.sector2_ms ?? null, null];
  if (level === 0)
    return (
      <div className="flex h-full flex-col justify-center">
        <Label>Vuelta actual</Label>
        <span className="display num font-bold not-italic" style={fs(42, 20)}>{lapTime(lap?.current_lap_ms)}</span>
      </div>
    );
  return (
    <div className="flex h-full flex-col justify-between gap-[3cqh]">
      <div className="flex items-baseline justify-between">
        <Label>Tiempos</Label>
        <span className="display num font-bold not-italic" style={fs(20, 9)}>{lapTime(lap?.current_lap_ms)}</span>
      </div>
      <div className="grid grid-cols-3 gap-[2cqw]">
        {sectors.map((v, i) => {
          const current = lap?.sector === i + 1;
          return (
            <div key={i} className={`rounded-[8px] px-[3cqw] py-[3cqh] ${current ? "border border-line" : "bg-bg"}`}>
              <div className="eyebrow">S{i + 1}{current ? " · en curso" : ""}</div>
              <div className="display num font-bold not-italic" style={fs(18, 7)}>{v ? (v / 1000).toFixed(3).replace(".", ",") : "—"}</div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[min(10cqh,4.2cqw)] text-muted num">
        <span>Última <b className="text-fg">{lapTime(lap?.last_lap_ms)}</b></span>
        <span>Mejor <b className="text-best">{lapTime(best)}</b></span>
      </div>
    </div>
  );
}

function Position({ s, level }: { s: Snapshot | null; level: number }) {
  const lap = s?.lap;
  const race = s ? isRace(s) : false;
  const left = s?.session?.time_left_s;
  const gained = lap && lap.grid_position ? lap.grid_position - lap.position : null;
  return (
    <div className={`flex h-full ${level >= 2 ? "flex-col justify-center" : "items-center justify-between"} gap-2`}>
      <span className="display" style={fs(level >= 2 ? 50 : 72, level ? 30 : 60)}>{lap ? `P${lap.position}` : "—"}</span>
      {level >= 1 && (
        <span className={level >= 2 ? "" : "text-right"}>
          <Label>{race ? "Vuelta" : "Queda"}</Label>
          <span className="display font-bold not-italic" style={fs(34, 16)}>
            {race ? `${lap?.lap ?? "—"}/${s?.session?.total_laps ?? "—"}` : left != null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "—"}
          </span>
        </span>
      )}
      {level >= 2 && race && gained != null && gained !== 0 && (
        <span className={`text-[min(11cqh,8cqw)] ${gained > 0 ? "text-ok" : "text-warn"}`}>{gained > 0 ? `ganaste ${gained}` : `perdiste ${-gained}`} desde la largada</span>
      )}
    </div>
  );
}

function aroundRows(s: Snapshot | null, n: number) {
  if (!s?.relatives) return [];
  const byIndex = new Map((s.cars ?? []).map((c) => [c.index, c]));
  const ahead = s.relatives.ahead.slice(0, Math.floor((n - 1) / 2)).reverse();
  const behind = s.relatives.behind.slice(0, Math.ceil((n - 1) / 2));
  const me = player(s);
  return [
    ...ahead.map((r) => ({ r, car: byIndex.get(r.index), me: false, side: -1 })),
    ...(me ? [{ r: null, car: me, me: true, side: 0 }] : []),
    ...behind.map((r) => ({ r, car: byIndex.get(r.index), me: false, side: 1 })),
  ];
}

function Around({ s, level, rows }: { s: Snapshot | null; level: number; rows: number }) {
  const behind = s?.relatives?.behind[0];
  const ahead = s?.relatives?.ahead[0];
  const cars = new Map((s?.cars ?? []).map((c) => [c.index, c]));
  if (rows === 0) {
    const attack = behind && behind.gap_s != null && behind.gap_s < 1 && behind.relation == null;
    const pick = level === 0 ? (attack ? { r: behind!, ahead: false } : ahead ? { r: ahead, ahead: true } : behind ? { r: behind, ahead: false } : null) : null;
    const one = (r: typeof ahead, isAhead: boolean, single: boolean) => {
      if (!r) return null;
      const car = cars.get(r.index);
      const hot = !isAhead && r.gap_s != null && r.gap_s < 0.5 && r.relation == null;
      return (
        <div className={`flex min-h-0 flex-1 items-center justify-between gap-2 rounded-[10px] ${single ? "" : "px-[4cqw]"} ${hot && !single ? "bg-danger/15" : ""}`}>
          <span className="min-w-0">
            <Label tone={hot ? "!text-accent-ink" : undefined}>{isAhead ? "Adelante" : "Atrás"} · {car ? shortName(car) : "—"}</Label>
            {hot && <span className="block text-[min(20cqh,6cqw)] leading-tight text-accent-ink">te ataca</span>}
          </span>
          <span className={`display ${hot ? "text-accent-ink" : ""}`} style={fs(level === 0 ? 50 : 30, 18)}>{r.gap_s == null ? "—" : `${isAhead ? "−" : "+"}${dec(r.gap_s)}`}</span>
        </div>
      );
    };
    if (pick) return <div className={`-mx-1 flex h-full ${pick.ahead ? "" : ""}`}>{one(pick.r, pick.ahead, true)}</div>;
    if (!ahead && !behind) return <Empty />;
    return <div className="flex h-full flex-col gap-[3cqh]">{one(ahead, true, false)}{one(behind, false, false)}</div>;
  }
  const list = aroundRows(s, rows);
  const catchIn = s?.pace?.ahead?.laps_to_catch;
  return (
    <div className="flex h-full flex-col gap-[1.2cqh]">
      <div className="flex justify-between"><Label>Alrededor tuyo</Label><span className="eyebrow">en pista</span></div>
      {list.length === 0 && <Empty />}
      {list.map(({ r, car, me, side }, i) => {
        const hot = side === 1 && r?.gap_s != null && r.gap_s < 0.5 && r.relation == null;
        return (
          <div key={i} className={`flex min-h-0 flex-1 items-center gap-[3cqw] rounded-[8px] px-[3cqw] ${me ? "bg-ok/10" : hot ? "bg-danger/15" : ""}`}>
            <span className="display w-[14cqw] font-bold not-italic text-dim" style={fs(8, 7)}>P{car?.position ?? "—"}</span>
            <span className="h-[50%] w-1 rounded" style={{ background: car?.color ?? teamColor(car?.team_id) }} />
            <span className="min-w-0 flex-1 truncate font-semibold" style={fs(8, 7)}>{me ? "Vos" : car ? shortName(car) : "—"}</span>
            {r?.relation && <span className="eyebrow">{r.relation === "lapped" ? "doblado" : "te dobla"}</span>}
            {r?.pit && <span className="eyebrow">en boxes</span>}
            <span className={`display num font-bold not-italic ${hot ? "text-accent-ink" : ""}`} style={fs(9, 8)}>{r?.gap_s == null ? "" : `${side < 0 ? "−" : "+"}${dec(r.gap_s)}`}</span>
          </div>
        );
      })}
      {level >= 3 && catchIn != null && catchIn > 0 && catchIn < 20 && (
        <div className="border-t border-line pt-[2cqh] text-[min(5cqh,5cqw)] text-muted">
          Con este ritmo alcanzás al de adelante en <b className="text-fg">{catchIn} {catchIn === 1 ? "vuelta" : "vueltas"}</b>.
        </div>
      )}
    </div>
  );
}

function Standings({ s, rows }: { s: Snapshot | null; level: number; rows: number }) {
  const cars = (s?.cars ?? []).filter((c) => c.position > 0 && c.result !== "inactive").sort((a, b) => a.position - b.position);
  if (!cars.length) return <Empty />;
  const me = cars.findIndex((c) => c.is_player);
  const start = cars.length <= rows ? 0 : Math.max(0, Math.min(me - Math.floor(rows / 2), cars.length - rows));
  const shown = cars.slice(start, start + rows);
  return (
    <div className="flex h-full flex-col gap-[0.6cqh]">
      {shown.map((c) => (
        <div key={c.index} className={`flex min-h-0 flex-1 items-center gap-[2.5cqw] rounded-[8px] px-[2.5cqw] ${c.is_player ? "paper" : "bg-bg/60"}`}>
          <span className="display w-[9cqw] text-right" style={fs(5, 6)}>{c.position}</span>
          <span className="h-[55%] w-1 rounded" style={{ background: c.color ?? teamColor(c.team_id) }} />
          <span className="min-w-0 flex-1 truncate font-semibold" style={fs(4.6, 5.5)}>{c.is_player ? "Vos" : shortName(c)}</span>
          {c.tyre && <TyreDot compound={c.tyre} size={14} />}
          {c.pit_stops > 0 && <span className="eyebrow">{c.pit_stops}P</span>}
          <span className="display num w-[18cqw] text-right font-bold not-italic" style={fs(4.6, 5.5)}>
            {c.position === 1 ? "Líder" : c.gap_leader_ms ? `+${dec(c.gap_leader_ms / 1000)}` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function MapPiece({ s, level }: { s: Snapshot | null; level: number }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-between"><Label>Pista</Label>{s?.session && <span className="eyebrow">{s.cars?.filter((c) => c.result === "active").length ?? 0} autos</span>}</div>
      <TrackOutline trackId={s?.track?.id} corners={s?.track?.corners} cars={s?.cars} showCorners={level >= 1} className="min-h-0 w-full flex-1" />
    </div>
  );
}

function TyresPiece({ s, level }: { s: Snapshot | null; level: number }) {
  const t = s?.car?.tyres_surface_temperature_c;
  const w = s?.damage?.tyres_wear_percent;
  const p = s?.car?.tyres_pressure_psi;
  const b = s?.car?.brakes_temperature_c;
  const bl = s?.damage?.tyre_blisters_percent;
  const car = <CarTyres temps={t} wear={w} className="h-full w-full" label="Gomas: color por temperatura" />;
  if (level === 0) return <div className="h-full py-[4cqh]">{car}</div>;
  const cell = (k: "front_left" | "front_right" | "rear_left" | "rear_right", right: boolean) => (
    <div className={`num ${right ? "" : "text-right"}`}>
      <div className="display font-bold not-italic" style={{ ...fs(level >= 2 ? 11 : 13, level >= 2 ? 7 : 16), color: t && t[k] > 100 ? tyreColor(t[k]) : undefined }}>{t ? `${Math.round(t[k])}°` : "—"}</div>
      <div className="text-dim" style={fs(level >= 2 ? 6 : 7, level >= 2 ? 3.6 : 9)}>
        {w ? <span className="whitespace-nowrap">{level >= 2 ? "vida " : ""}{Math.round(100 - w[k])}%</span> : ""}
        {level >= 2 && p ? <><br />{dec(p[k])} psi</> : null}
        {level >= 2 && bl && bl[k] > 0 ? <><br />ampollas {Math.round(bl[k])}%</> : level >= 2 && b ? <><br />freno {Math.round(b[k])}°</> : null}
      </div>
    </div>
  );
  return (
    <div className="flex h-full flex-col gap-[2cqh]">
      {level >= 2 && (
        <div className="flex items-center justify-between">
          <Label>Gomas</Label>
          {s?.status && (
            <span className="flex items-center gap-2 text-[min(7cqh,3.5cqw)]">
              <TyreDot compound={s.status.tyre} filled size={12} /> {s.status.tyre_age_laps} vueltas
            </span>
          )}
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_minmax(0,1.1fr)_1fr] items-center gap-[2cqw]">
        <div className="flex h-full flex-col justify-around">{cell("front_left", false)}{cell("rear_left", false)}</div>
        <div className="h-full min-h-0">{car}</div>
        <div className="flex h-full flex-col justify-around">{cell("front_right", true)}{cell("rear_right", true)}</div>
      </div>
    </div>
  );
}

function Energy({ s, level }: { s: Snapshot | null; level: number }) {
  const st = s?.status;
  if (!st) return <Empty />;
  return (
    <div className="flex h-full flex-col justify-center gap-[4cqh]">
      {level >= 1 && <Label>Energía</Label>}
      <span className={`display ${st.ers_percent < 10 ? "text-warn" : ""}`} style={fs(level ? 34 : 55, 34)}>{Math.round(st.ers_percent)}%</span>
      {level >= 1 && (
        <>
          <div className="h-2 rounded bg-panel-2"><div className="h-2 rounded bg-[#7c8cff]" style={{ width: `${Math.min(100, st.ers_percent)}%` }} /></div>
          <span className="text-[min(9cqh,7cqw)] text-muted">
            Modo {ERS_MODE_ES[st.ers_mode] ?? st.ers_mode} · cosechaste {dec(st.ers_harvested_lap_mj)}
            {st.ers_harvest_limit_mj ? ` de ${dec(st.ers_harvest_limit_mj, 0)}` : ""} MJ
          </span>
        </>
      )}
    </div>
  );
}

function Fuel({ s, level }: { s: Snapshot | null; level: number }) {
  const st = s?.status;
  if (!st) return <Empty />;
  const v = st.fuel_remaining_laps;
  return (
    <div className="flex h-full flex-col justify-center">
      <Label>Combustible</Label>
      <span className={`display ${v < 0 ? "text-danger" : "text-ok"}`} style={fs(level ? 30 : 52, 24)}>{`${v >= 0 ? "+" : "−"}${dec(Math.abs(v))} v`}</span>
      {level >= 1 && <span className="text-[min(9cqh,7cqw)] text-muted">{dec(st.fuel_kg)} kg · mezcla {FUEL_MIX_ES[st.fuel_mix] ?? st.fuel_mix}</span>}
    </div>
  );
}

function Damage({ s, level }: { s: Snapshot | null; level: number }) {
  const d = s?.damage;
  if (!d) return <Empty />;
  const parts: [string, number][] = [["Alerón del. izq.", d.front_left_wing], ["Alerón del. der.", d.front_right_wing], ["Alerón trasero", d.rear_wing], ["Piso", d.floor], ["Difusor", d.diffuser], ["Motor", d.engine], ["Caja", d.gearbox]];
  const worst = parts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const tone = (v: number) => (v >= 30 ? "text-danger" : v >= 10 ? "text-warn" : "text-muted");
  if (level === 0)
    return (
      <div className="flex h-full flex-col justify-center">
        <Label>Daños</Label>
        <span className={`display ${tone(worst[1])}`} style={fs(36, 26)}>{worst[1] ? `${Math.round(worst[1])}%` : "Sano"}</span>
      </div>
    );
  return (
    <div className="flex h-full flex-col gap-[1.5cqh]">
      <Label>Daños</Label>
      {parts.filter(([, v]) => v > 0).slice(0, 5).map(([n, v]) => (
        <div key={n} className="flex justify-between text-[min(9cqh,7cqw)]"><span>{n}</span><span className={`num font-semibold ${tone(v)}`}>{Math.round(v)}%</span></div>
      ))}
      {worst[1] === 0 && <span className="text-[min(10cqh,8cqw)] text-ok">Todo sano</span>}
    </div>
  );
}

function Weather({ s, level }: { s: Snapshot | null; level: number }) {
  const ses = s?.session;
  if (!ses) return <Empty />;
  const next = ses.forecast.find((f) => f.in_minutes >= 10) ?? ses.forecast[1];
  return (
    <div className="flex h-full flex-col justify-center gap-[3cqh]">
      <Label>Clima</Label>
      <span className="text-[min(22cqh,7cqw)] leading-tight">
        <b>{WEATHER_ES[ses.weather] ?? ses.weather}</b>
        {next && <> · <span className="text-info">{next.rain_percent}% en {next.in_minutes} min</span></>}
      </span>
      {level >= 1 && (
        <div className="flex gap-[2cqw]">
          {ses.forecast.slice(0, 5).map((f) => (
            <div key={f.in_minutes} className="flex-1 rounded-[8px] bg-bg py-[3cqh] text-center">
              <div className="eyebrow">{f.in_minutes ? `+${f.in_minutes}` : "ahora"}</div>
              <div className="display font-bold not-italic text-info" style={fs(14, 6)}>{f.rain_percent}%</div>
            </div>
          ))}
        </div>
      )}
      {level >= 1 && <span className="text-[min(8cqh,4cqw)] text-muted">pista {ses.track_temperature_c}° · aire {ses.air_temperature_c}°</span>}
    </div>
  );
}

function Pedals({ s }: { s: Snapshot | null }) {
  const t = s?.car?.throttle ?? 0;
  const b = s?.car?.brake ?? 0;
  return (
    <div className="flex h-full items-end justify-center gap-[12cqw] pb-[2cqh]" role="img" aria-label={`Acelerador ${Math.round(t * 100)}%, freno ${Math.round(b * 100)}%`}>
      {[["var(--color-ok)", t], ["var(--color-accent)", b]].map(([c, v], i) => (
        <div key={i} className="relative h-[90%] w-[28cqw] overflow-hidden rounded-[6px] bg-panel-2">
          <div className="absolute inset-x-0 bottom-0" style={{ height: `${(v as number) * 100}%`, background: c as string }} />
        </div>
      ))}
    </div>
  );
}

function Radio({ messages, level, talk }: { messages: EngineerMessage[]; level: number; talk?: ReactNode }) {
  const said = messages.filter((m) => m.radio);
  const last = said.slice(-1)[0];
  const prev = said.slice(-2, -1)[0];
  return (
    <div className="flex h-full flex-col gap-[3cqh]">
      <div className="flex justify-between"><Label tone="!text-paper-muted">Radio{last?.lap ? ` · vuelta ${last.lap}` : ""}</Label></div>
      <div className="title min-h-0 flex-1 overflow-hidden normal-case" style={fs(level ? 18 : 34, 5.5)}>{last?.radio ?? "Sin mensajes todavía."}</div>
      {level >= 1 && prev?.radio && <div className="truncate text-paper-muted" style={fs(9, 3)}>Antes: {prev.radio}</div>}
      {level >= 1 && talk}
    </div>
  );
}

function Aero({ s }: { s: Snapshot | null }) {
  const a = s?.aero;
  if (!a?.regulations_2026) return <div className="grid h-full place-items-center text-center text-[min(12cqh,8cqw)] text-dim">Solo con el reglamento 2026</div>;
  return (
    <div className="flex h-full flex-col justify-center gap-[3cqh]">
      <Label>Aerodinámica</Label>
      <span className="title" style={fs(26, 12)}>{a.active_aero_mode === "straight" ? "Modo recta" : "Modo curva"}</span>
      <span className={`text-[min(16cqh,7cqw)] ${a.overtake_available ? "text-ok" : "text-muted"}`}>{a.overtake_active ? "Adelantamiento activo" : a.overtake_available ? "Adelantamiento disponible" : "Sin adelantamiento"}</span>
    </div>
  );
}
