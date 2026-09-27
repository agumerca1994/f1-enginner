import { Bar, Empty, Panel } from "@/components/dashboard/Panel";
import {
  damageLevel,
  EVENT_LABELS,
  gap,
  lapTime,
  levelClass,
  tyreTempLevel,
  wearLevel,
} from "@/lib/format";
import type { Snapshot, Wheels } from "@/lib/types";

export function PositionCard({ s }: { s: Snapshot }) {
  const lap = s.lap;
  if (!lap) return <Panel title="Carrera"><Empty /></Panel>;
  const gained = lap.grid_position ? lap.grid_position - lap.position : 0;
  return (
    <Panel title="Carrera" age={lap.age_s}>
      <div className="flex items-end justify-between">
        <div>
          <div className="num text-6xl font-semibold leading-none">P{lap.position}</div>
          {gained !== 0 && (
            <div className={`num mt-1 text-sm ${gained > 0 ? "text-ok" : "text-danger"}`}>
              {gained > 0 ? `▲ ${gained}` : `▼ ${-gained}`} desde la grilla
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="label">Vuelta</div>
          <div className="num text-3xl font-semibold">
            {lap.lap}
            <span className="text-muted">/{s.session?.total_laps || "—"}</span>
          </div>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Al de adelante" value={gap(lap.gap_ahead_ms)} />
        <Stat label="Al líder" value={gap(lap.gap_leader_ms)} />
        <Stat
          label="Boxes"
          value={lap.pit === "On track" ? `${lap.pit_stops} paradas` : "EN BOXES"}
          className={lap.pit === "On track" ? "" : "text-warn"}
        />
      </dl>
      {(lap.penalties_s > 0 || lap.warnings > 0) && (
        <p className="mt-3 text-sm text-warn">
          {lap.penalties_s > 0 && `Penalización +${lap.penalties_s}s · `}
          {lap.warnings} advertencia{lap.warnings === 1 ? "" : "s"}
        </p>
      )}
    </Panel>
  );
}

export function TimingCard({ s }: { s: Snapshot }) {
  const lap = s.lap;
  if (!lap) return <Panel title="Tiempos"><Empty /></Panel>;
  const s3 =
    lap.sector === 3 && lap.sector1_ms && lap.sector2_ms ? lap.current_lap_ms - lap.sector1_ms - lap.sector2_ms : null;
  return (
    <Panel
      title="Tiempos"
      age={lap.age_s}
      right={lap.lap_invalid ? <span className="rounded bg-danger/20 px-2 py-0.5 text-xs text-danger">Vuelta inválida</span> : null}
    >
      <div className="num text-4xl font-semibold">{lapTime(lap.current_lap_ms)}</div>
      <div className="mt-1 text-sm text-muted">
        Última: <span className="num text-fg">{lapTime(lap.last_lap_ms)}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[lap.sector1_ms, lap.sector2_ms, s3].map((ms, i) => (
          <div
            key={i}
            className={`rounded-lg border p-2 text-center ${lap.sector === i + 1 ? "border-accent/60" : "border-line"}`}
          >
            <div className="label">S{i + 1}</div>
            <div className="num text-sm">{ms && lap.sector > i + 1 ? (ms / 1000).toFixed(3) : "—"}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function CarCard({ s }: { s: Snapshot }) {
  const car = s.car;
  if (!car) return <Panel title="Auto"><Empty /></Panel>;
  const maxRpm = s.status?.max_rpm || 13000;
  const gear = car.gear === 0 ? "N" : car.gear === -1 ? "R" : String(car.gear);
  return (
    <Panel
      title="Auto"
      age={car.age_s}
      right={
        car.drs_open ? (
          <span className="rounded bg-ok/20 px-2 py-0.5 text-xs font-semibold text-ok">DRS</span>
        ) : s.status?.drs_allowed ? (
          <span className="rounded border border-ok/40 px-2 py-0.5 text-xs text-ok">DRS disponible</span>
        ) : null
      }
    >
      <div className="flex items-end justify-between">
        <div>
          <div className="num text-6xl font-semibold leading-none">{car.speed_kmh}</div>
          <div className="label mt-1">km/h</div>
        </div>
        <div className="num text-7xl font-bold leading-none text-accent">{gear}</div>
      </div>
      <div className="mt-4 space-y-2">
        <Row label="RPM" value={car.rpm.toLocaleString("es-AR")}>
          <Bar value={(car.rpm / maxRpm) * 100} className={car.rpm / maxRpm > 0.95 ? "bg-danger" : "bg-accent"} />
        </Row>
        <Row label="Acelerador" value={`${Math.round(car.throttle * 100)}%`}>
          <Bar value={car.throttle * 100} className="bg-ok" />
        </Row>
        <Row label="Freno" value={`${Math.round(car.brake * 100)}%`}>
          <Bar value={car.brake * 100} className="bg-danger" />
        </Row>
      </div>
      <div className="mt-3 text-xs text-muted">
        Motor <span className="num text-fg">{car.engine_temperature_c}°C</span>
        {s.status && (
          <>
            {" · "}Reparto de frenada <span className="num text-fg">{s.status.brake_bias}%</span>
          </>
        )}
      </div>
    </Panel>
  );
}

const COMPOUND_CLASS: Record<string, string> = {
  Soft: "bg-soft text-bg",
  Medium: "bg-medium text-bg",
  Hard: "bg-hard text-bg",
  Intermediate: "bg-inter text-bg",
  Wet: "bg-wet text-white",
};
const COMPOUND_ES: Record<string, string> = {
  Soft: "Blando",
  Medium: "Medio",
  Hard: "Duro",
  Intermediate: "Intermedio",
  Wet: "Lluvia",
};

export function TyresCard({ s }: { s: Snapshot }) {
  const wear = s.damage?.tyres_wear_percent;
  const car = s.car;
  const st = s.status;
  if (!wear && !car) return <Panel title="Neumáticos"><Empty /></Panel>;
  const wheel = (key: keyof Wheels, label: string) => (
    <div className="rounded-xl bg-panel-2 p-3">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {wear && <span className={`num text-lg font-semibold ${levelClass(wearLevel(wear[key]))}`}>{wear[key].toFixed(0)}%</span>}
      </div>
      {car && (
        <div className="num mt-1 text-xs text-muted">
          <span className={levelClass(tyreTempLevel(car.tyres_surface_temperature_c[key]))}>
            {car.tyres_surface_temperature_c[key]}°
          </span>{" "}
          sup · {car.tyres_inner_temperature_c[key]}° int · {car.tyres_pressure_psi[key].toFixed(1)} psi
        </div>
      )}
    </div>
  );
  return (
    <Panel
      title="Neumáticos"
      age={s.damage?.age_s ?? car?.age_s}
      right={
        st ? (
          <span className="flex items-center gap-2 text-xs text-muted">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COMPOUND_CLASS[st.tyre] ?? "bg-panel-2"}`}>
              {COMPOUND_ES[st.tyre] ?? st.tyre} {st.tyre_compound}
            </span>
            {st.tyre_age_laps} v
          </span>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {wheel("front_left", "Del. izq")}
        {wheel("front_right", "Del. der")}
        {wheel("rear_left", "Tras. izq")}
        {wheel("rear_right", "Tras. der")}
      </div>
    </Panel>
  );
}

const FUEL_MIX_ES: Record<string, string> = { Lean: "pobre", Standard: "estándar", Rich: "rica", Max: "máxima" };
const ERS_MODE_ES: Record<string, string> = { None: "apagado", Medium: "medio", Hotlap: "vuelta rápida", Overtake: "adelantamiento" };

export function FuelErsCard({ s }: { s: Snapshot }) {
  const st = s.status;
  if (!st) return <Panel title="Combustible y ERS"><Empty /></Panel>;
  const margin = st.fuel_remaining_laps;
  const marginClass = margin < 0 ? "text-danger" : margin < 0.5 ? "text-warn" : "text-ok";
  return (
    <Panel title="Combustible y ERS" age={st.age_s}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="num text-3xl font-semibold">
            {st.fuel_kg.toFixed(1)}
            <span className="text-base text-muted"> kg</span>
          </div>
          <div className={`num text-sm ${marginClass}`}>
            {margin >= 0 ? "+" : ""}
            {margin.toFixed(2)} vueltas de margen
          </div>
          <div className="mt-1 text-xs text-muted">Mezcla {FUEL_MIX_ES[st.fuel_mix] ?? st.fuel_mix}</div>
        </div>
        <div>
          <div className="num text-3xl font-semibold">
            {st.ers_percent.toFixed(0)}
            <span className="text-base text-muted">%</span>
          </div>
          <Bar value={st.ers_percent} className="bg-accent" />
          <div className="mt-1 text-xs text-muted">Modo {ERS_MODE_ES[st.ers_mode] ?? st.ers_mode}</div>
        </div>
      </div>
    </Panel>
  );
}

export function DamageCard({ s }: { s: Snapshot }) {
  const d = s.damage;
  if (!d) return <Panel title="Daños"><Empty /></Panel>;
  const items: [string, number][] = [
    ["Alerón del. izq", d.front_left_wing],
    ["Alerón del. der", d.front_right_wing],
    ["Alerón trasero", d.rear_wing],
    ["Piso", d.floor],
    ["Difusor", d.diffuser],
    ["Pontón", d.sidepod],
    ["Caja de cambios", d.gearbox],
    ["Motor", d.engine],
  ];
  return (
    <Panel title="Daños" age={d.age_s}>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {items.map(([label, pct]) => (
          <li key={label} className="flex items-center justify-between">
            <span className="text-muted">{label}</span>
            <span className={`num ${pct === 0 ? "text-muted" : levelClass(damageLevel(pct))}`}>{pct}%</span>
          </li>
        ))}
      </ul>
      {(d.drs_fault || d.ers_fault) && (
        <p className="mt-3 text-sm text-danger">
          {d.drs_fault && "Falla de DRS "}
          {d.ers_fault && "Falla de ERS"}
        </p>
      )}
    </Panel>
  );
}

const WEATHER_ES: Record<string, string> = {
  Clear: "Despejado",
  "Light cloud": "Algo nublado",
  Overcast: "Nublado",
  "Light rain": "Lluvia leve",
  "Heavy rain": "Lluvia fuerte",
  Storm: "Tormenta",
};

export function WeatherCard({ s }: { s: Snapshot }) {
  const se = s.session;
  if (!se) return <Panel title="Clima"><Empty /></Panel>;
  return (
    <Panel title="Clima" age={se.age_s}>
      <div className="flex items-end justify-between">
        <div className="text-xl font-semibold">{WEATHER_ES[se.weather] ?? se.weather}</div>
        <div className="num text-sm text-muted">
          Pista <span className="text-fg">{se.track_temperature_c}°</span> · Aire{" "}
          <span className="text-fg">{se.air_temperature_c}°</span>
        </div>
      </div>
      {se.forecast.length > 0 && (
        <ol className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(4.25rem,1fr))] gap-2">
          {se.forecast.map((f) => (
            <li key={f.in_minutes} className="rounded-lg bg-panel-2 p-2 text-center">
              <div className="label">+{f.in_minutes}′</div>
              <div className="text-xs">{WEATHER_ES[f.weather] ?? f.weather}</div>
              <div className={`num text-xs ${f.rain_percent >= 50 ? "text-wet" : "text-muted"}`}>{f.rain_percent}% lluvia</div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function EventsCard({ s }: { s: Snapshot }) {
  const events = [...s.events].reverse();
  return (
    <Panel title="Eventos">
      {events.length === 0 ? (
        <Empty>Sin eventos todavía</Empty>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {events.map((e, i) => (
            <li key={`${e.session_time}-${i}`} className="flex justify-between gap-2">
              <span>{EVENT_LABELS[e.code] ?? e.code}</span>
              <span className="num text-muted">{formatSessionTime(e.session_time)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function formatSessionTime(t: number): string {
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg bg-panel-2 p-2">
      <dt className="label">{label}</dt>
      <dd className={`num mt-0.5 text-sm ${className}`}>{value}</dd>
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
