import { Bar, Empty, Panel } from "@/components/dashboard/Panel";
import { EVENT_LABELS, gap, lapTime, WEATHER_ES } from "@/lib/format";
import { COMPOUND_COLORS, COMPOUND_LETTER, teamColor } from "@/lib/teams";
import type { CarRow, Snapshot } from "@/lib/types";

const SESSION_ES: Record<string, string> = {
  Race: "Carrera",
  "Race 2": "Carrera 2",
  "Race 3": "Carrera 3",
  "Time Trial": "Contrarreloj",
  "Practice 1": "Práctica 1",
  "Practice 2": "Práctica 2",
  "Practice 3": "Práctica 3",
  "Short Practice": "Práctica corta",
  "Qualifying 1": "Clasificación 1",
  "Qualifying 2": "Clasificación 2",
  "Qualifying 3": "Clasificación 3",
  "Short Qualifying": "Clasificación corta",
  "One-Shot Qualifying": "Clasificación a una vuelta",
};
const FUEL_MIX_ES: Record<string, string> = { Lean: "pobre", Standard: "estándar", Rich: "rica", Max: "máxima" };
const ERS_MODE_ES: Record<string, string> = { None: "recarga", Medium: "normal", Hotlap: "vuelta rápida", Overtake: "adelantamiento" };

export function sessionName(type: string): string {
  return type === "Unknown" ? "Sesión" : (SESSION_ES[type] ?? type);
}

// --- Session -----------------------------------------------------------------

export function SessionCard({ s }: { s: Snapshot }) {
  const se = s.session;
  const lap = s.lap;
  if (!se) return <Panel title="Sesión"><Empty /></Panel>;
  const isRace = se.type.startsWith("Race");
  const gained = lap && lap.grid_position ? lap.grid_position - lap.position : 0;
  return (
    <Panel title="Sesión" age={se.age_s}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xl font-semibold">{se.track}</div>
          <div className="text-sm text-muted">
            {sessionName(se.type)}
            {se.online && " · online"}
          </div>
        </div>
        {lap && (
          <div className="text-right">
            <div className="num text-4xl font-semibold leading-none">P{lap.position}</div>
            {isRace && gained !== 0 && (
              <div className={`num text-xs ${gained > 0 ? "text-ok" : "text-danger"}`}>
                {gained > 0 ? `▲${gained}` : `▼${-gained}`} desde P{lap.grid_position}
              </div>
            )}
          </div>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Vuelta" value={lap ? `${lap.lap}/${se.total_laps || "—"}` : "—"} />
        <Stat
          label={isRace ? "Ventana box" : "Restante"}
          value={isRace ? pitWindow(se.pit_window_ideal_lap, se.pit_window_latest_lap) : clock(se.time_left_s)}
        />
        <Stat label="Paradas" value={lap ? String(lap.pit_stops) : "—"} />
      </dl>

      {(se.safety_car !== "None" || se.paused) && (
        <div className="mt-3 flex gap-2 text-xs font-semibold">
          {se.safety_car !== "None" && (
            <span className="rounded bg-warn px-2 py-1 text-bg">
              {se.safety_car === "Virtual safety car" ? "VSC" : se.safety_car === "Formation lap" ? "Vuelta de formación" : "SAFETY CAR"}
            </span>
          )}
          {se.paused && <span className="rounded border border-warn px-2 py-1 text-warn">En pausa</span>}
        </div>
      )}

      <div className="mt-4 flex items-baseline justify-between">
        <span className="font-medium">{WEATHER_ES[se.weather] ?? se.weather}</span>
        <span className="num text-xs text-muted">
          Pista <span className="text-fg">{se.track_temperature_c}°</span> · Aire{" "}
          <span className="text-fg">{se.air_temperature_c}°</span>
        </span>
      </div>
      {se.forecast.length > 0 && (
        <ol className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(3.6rem,1fr))] gap-1.5">
          {se.forecast.map((f) => (
            <li key={f.in_minutes} className="rounded-lg bg-panel-2 px-1 py-1.5 text-center">
              <div className="label">+{f.in_minutes}′</div>
              <div className="truncate text-[0.7rem]">{WEATHER_ES[f.weather] ?? f.weather}</div>
              <div className={`num text-[0.7rem] ${f.rain_percent >= 40 ? "text-wet" : "text-muted"}`}>{f.rain_percent}%</div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function pitWindow(ideal: number | null, latest: number | null): string {
  if (!ideal && !latest) return "—";
  return `v${ideal ?? "?"}–${latest ?? "?"}`;
}

function clock(seconds: number): string {
  if (!seconds) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// --- Telemetry ---------------------------------------------------------------

const REV_LEDS = 15;

export function TelemetryCard({ s }: { s: Snapshot }) {
  const car = s.car;
  const st = s.status;
  if (!car) return <Panel title="Telemetría"><Empty /></Panel>;
  const gear = car.gear === 0 ? "N" : car.gear === -1 ? "R" : String(car.gear);
  const suggest = car.suggested_gear && car.suggested_gear !== car.gear ? car.suggested_gear : null;
  // The game sends 0 when its rev-lights assist is off; then light them from the RPM,
  // starting at 75% of the limiter like a real wheel.
  const maxRpm = st?.max_rpm || 13000;
  const revPercent = car.rev_lights_percent || Math.max(0, Math.min(100, ((car.rpm / maxRpm - 0.75) / 0.25) * 100));
  const lit = Math.round((revPercent / 100) * REV_LEDS);
  const margin = st?.fuel_remaining_laps ?? 0;

  return (
    <Panel
      title="Telemetría"
      age={car.age_s}
      right={
        car.drs_open ? (
          <span className="rounded bg-ok px-2 py-0.5 text-xs font-bold text-bg">DRS</span>
        ) : st?.drs_allowed ? (
          <span className="rounded border border-ok/50 px-2 py-0.5 text-xs text-ok">DRS disponible</span>
        ) : null
      }
    >
      {/* Rev lights: green, red, then blue at the limit, like the steering wheel */}
      <div className="mb-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${REV_LEDS}, minmax(0, 1fr))` }}>
        {Array.from({ length: REV_LEDS }, (_, i) => {
          const color = i < 5 ? "#34d399" : i < 10 ? "#f43f5e" : "#818cf8";
          return <span key={i} className="h-2.5 rounded-sm" style={{ background: i < lit ? color : "#1d2530" }} />;
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="num text-6xl font-semibold leading-none">{car.speed_kmh}</div>
          <div className="label mt-1">km/h</div>
        </div>
        <div className="relative px-6 text-center">
          <div className="num text-8xl font-bold leading-none text-accent">{gear}</div>
          {suggest && (
            <div className="num absolute right-0 top-0 rounded bg-warn px-1.5 text-sm font-bold text-bg" title="Marcha sugerida">
              {suggest > car.gear ? "↑" : "↓"}
              {suggest}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="num text-2xl font-semibold leading-none">{car.rpm.toLocaleString("es-AR")}</div>
          <div className="label mt-1">rpm</div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Row label="Acelerador" value={`${Math.round(car.throttle * 100)}%`}>
          <Bar value={car.throttle * 100} className="bg-ok" />
        </Row>
        <Row label="Freno" value={`${Math.round(car.brake * 100)}%`}>
          <Bar value={car.brake * 100} className="bg-danger" />
        </Row>
        <Row label="Dirección" value={`${Math.round(car.steer * 100)}%`}>
          <div className="relative h-2 w-full rounded-full bg-panel-2">
            <div
              className="absolute top-0 h-2 rounded-full bg-accent transition-all duration-150"
              style={{ left: `${50 + Math.min(0, car.steer) * 50}%`, width: `${Math.abs(car.steer) * 50}%` }}
            />
            <div className="absolute left-1/2 top-[-2px] h-3 w-px bg-muted" />
          </div>
        </Row>
      </div>

      {st && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-panel-2 p-3">
            <div className="label">ERS</div>
            <div className="num text-2xl font-semibold">{st.ers_percent.toFixed(0)}%</div>
            <Bar value={st.ers_percent} className="bg-accent" />
            <div className="mt-1 text-xs text-muted">Modo {ERS_MODE_ES[st.ers_mode] ?? st.ers_mode}</div>
          </div>
          <div className="rounded-xl bg-panel-2 p-3">
            <div className="label">Combustible</div>
            <div className="num text-2xl font-semibold">
              {st.fuel_kg.toFixed(1)}
              <span className="text-sm text-muted"> kg</span>
            </div>
            <div className={`num text-xs ${margin < 0 ? "text-danger" : margin < 0.5 ? "text-warn" : "text-ok"}`}>
              {margin >= 0 ? "+" : ""}
              {margin.toFixed(2)} vueltas
            </div>
            <div className="text-xs text-muted">Mezcla {FUEL_MIX_ES[st.fuel_mix] ?? st.fuel_mix}</div>
          </div>
        </div>
      )}
      <div className="mt-3 text-xs text-muted">
        Motor <span className="num text-fg">{car.engine_temperature_c}°C</span>
        {st && (
          <>
            {" · "}Reparto de frenada <span className="num text-fg">{st.brake_bias}%</span>
          </>
        )}
      </div>
    </Panel>
  );
}

// --- Timing ------------------------------------------------------------------

export function TimingCard({ s }: { s: Snapshot }) {
  const lap = s.lap;
  if (!lap) return <Panel title="Tiempos"><Empty /></Panel>;
  const me = s.cars?.find((c) => c.is_player);
  const fastest = fastestLap(s.cars);
  const s3 = lap.sector === 3 && lap.sector1_ms && lap.sector2_ms ? lap.current_lap_ms - lap.sector1_ms - lap.sector2_ms : null;
  const delta = lap.last_lap_ms && me?.best_lap_ms ? lap.last_lap_ms - me.best_lap_ms : null;
  return (
    <Panel
      title="Tiempos"
      age={lap.age_s}
      right={lap.lap_invalid ? <span className="rounded bg-danger/20 px-2 py-0.5 text-xs text-danger">Vuelta inválida</span> : null}
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="col-span-2">
          <div className="label">Vuelta actual</div>
          <div className="num text-4xl font-semibold">{lapTime(lap.current_lap_ms)}</div>
        </div>
        <div>
          <div className="label">Última</div>
          <div className="num text-lg">{lapTime(lap.last_lap_ms)}</div>
          {delta != null && delta !== 0 && (
            <div className={`num text-xs ${delta > 0 ? "text-warn" : "text-ok"}`}>
              {delta > 0 ? "+" : ""}
              {(delta / 1000).toFixed(3)}
            </div>
          )}
        </div>
        <div>
          <div className="label">Mejor</div>
          <div className={`num text-lg ${me?.best_lap_ms && me.best_lap_ms === fastest ? "text-[#c084fc]" : ""}`}>{lapTime(me?.best_lap_ms)}</div>
          {fastest && <div className="num text-xs text-muted">récord {lapTime(fastest)}</div>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[lap.sector1_ms, lap.sector2_ms, s3].map((ms, i) => (
          <div key={i} className={`rounded-lg border p-2 text-center ${lap.sector === i + 1 ? "border-accent/60" : "border-line"}`}>
            <div className="label">S{i + 1}</div>
            <div className="num text-sm">{ms && lap.sector > i + 1 ? (ms / 1000).toFixed(3) : "—"}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span>
          Al de adelante <span className="num text-fg">{gap(lap.gap_ahead_ms)}</span>
        </span>
        <span>
          Al líder <span className="num text-fg">{gap(lap.gap_leader_ms)}</span>
        </span>
        {(lap.penalties_s > 0 || lap.warnings > 0) && (
          <span className="text-warn">
            {lap.penalties_s > 0 && `+${lap.penalties_s}s · `}
            {lap.warnings} adv.
          </span>
        )}
      </div>
    </Panel>
  );
}

function fastestLap(cars: CarRow[] | undefined): number | null {
  const times = (cars ?? []).map((c) => c.best_lap_ms).filter((t): t is number => !!t);
  return times.length ? Math.min(...times) : null;
}

// --- Standings ---------------------------------------------------------------

const RESULT_ES: Record<string, string> = { retired: "ABD", dnf: "ABD", dsq: "DSQ", not_classified: "NC", finished: "FIN" };

export function StandingsCard({ s }: { s: Snapshot }) {
  const cars = s.cars ?? [];
  if (cars.length === 0) return <Panel title="Posiciones"><Empty /></Panel>;
  const fastest = fastestLap(cars);
  return (
    <Panel title="Posiciones" age={s.lap?.age_s}>
      <ol className="-mx-1 space-y-0.5">
        {cars.map((c) => (
          <li
            key={c.index}
            className={`grid grid-cols-[1.6rem_0.25rem_minmax(0,1fr)_2.6rem_4.2rem] items-center gap-2 rounded-md px-1 py-1 text-sm ${
              c.is_player ? "bg-accent/15 ring-1 ring-accent/40" : ""
            }`}
          >
            <span className="num text-right text-muted">{c.position}</span>
            <span className="h-4 rounded-full" style={{ background: teamColor(c.team_id) }} />
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={`truncate ${c.is_player ? "font-semibold" : ""}`}>{shortName(c)}</span>
              {c.pit !== "On track" && <span className="rounded bg-warn px-1 text-[0.6rem] font-bold text-bg">BOX</span>}
              {c.penalties_s > 0 && <span className="num text-[0.65rem] text-warn">+{c.penalties_s}s</span>}
              {c.best_lap_ms && c.best_lap_ms === fastest && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#c084fc]" title="Vuelta más rápida" />
              )}
            </span>
            <span className="flex items-center gap-1">
              {c.tyre ? (
                <>
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full border-2 text-[0.5rem] font-bold"
                    style={{ borderColor: COMPOUND_COLORS[c.tyre] }}
                    title={c.tyre}
                  >
                    {COMPOUND_LETTER[c.tyre]}
                  </span>
                  <span className="num text-[0.65rem] text-muted">{c.tyre_age_laps}</span>
                </>
              ) : (
                <span className="text-muted">—</span>
              )}
            </span>
            <span className="num text-right text-xs text-muted">
              {RESULT_ES[c.result] ?? (c.position === 1 ? `V${c.lap}` : gap(c.gap_ahead_ms))}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function shortName(c: CarRow): string {
  if (!c.name) return c.race_number != null ? `#${c.race_number}` : `Auto ${c.index + 1}`;
  const n = c.name.trim();
  const pretty = n.charAt(0) + n.slice(1).toLowerCase();
  return pretty.length > 14 ? pretty.slice(0, 13) + "…" : pretty;
}

// --- Events ------------------------------------------------------------------

export function EventsCard({ s }: { s: Snapshot }) {
  const events = [...s.events].reverse().slice(0, 8);
  const name = (idx: unknown) => {
    const c = s.cars?.find((x) => x.index === idx);
    return c ? shortName(c) : null;
  };
  return (
    <Panel title="Eventos">
      {events.length === 0 ? (
        <Empty>Sin eventos todavía</Empty>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {events.map((e, i) => {
            const who =
              e.code === "OVTK"
                ? `${name(e.overtaking_vehicle_idx) ?? "?"} a ${name(e.being_overtaken_vehicle_idx) ?? "?"}`
                : e.code === "COLL"
                  ? `${name(e.vehicle1_idx) ?? "?"} y ${name(e.vehicle2_idx) ?? "?"}`
                  : "vehicle_idx" in e
                    ? name(e.vehicle_idx)
                    : null;
            return (
              <li key={`${e.session_time}-${i}`} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {EVENT_LABELS[e.code] ?? e.code}
                  {who && <span className="text-muted"> · {who}</span>}
                </span>
                <span className="num text-muted">{sessionClock(e.session_time)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function sessionClock(t: number): string {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

// --- Small pieces ------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel-2 p-2">
      <dt className="label">{label}</dt>
      <dd className="num mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="num">{value}</span>
      </div>
      {children}
    </div>
  );
}
