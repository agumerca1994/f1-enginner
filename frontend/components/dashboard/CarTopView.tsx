import { Empty, Panel } from "@/components/dashboard/Panel";
import { brakeTempColor, damageColor, levelClass, tyreTempColor, wearLevel } from "@/lib/format";
import { COMPOUND_COLORS } from "@/lib/teams";
import type { Snapshot, Wheels } from "@/lib/types";

const COMPOUND_ES: Record<string, string> = {
  Soft: "Blando",
  Medium: "Medio",
  Hard: "Duro",
  Intermediate: "Intermedio",
  Wet: "Lluvia",
};

type Wheel = keyof Wheels;
// Tyre rectangles in the SVG (car pointing up, 200 x 400).
const TYRES: Record<Wheel, { x: number; y: number; side: "left" | "right" }> = {
  front_left: { x: 14, y: 78, side: "left" },
  front_right: { x: 150, y: 78, side: "right" },
  rear_left: { x: 10, y: 272, side: "left" },
  rear_right: { x: 150, y: 272, side: "right" },
};
const TYRE_W = 36;

/** The car seen from above: tyres coloured by temperature with their wear, brakes, wings, floor and bodywork by damage. */
export function CarTopView({ s }: { s: Snapshot }) {
  const car = s.car;
  const d = s.damage;
  const st = s.status;
  if (!car && !d) return <Panel title="Monoplaza"><Empty /></Panel>;

  return (
    <Panel
      title="Monoplaza"
      age={d?.age_s ?? car?.age_s}
      right={
        st ? (
          <span className="flex items-center gap-2 text-xs text-muted">
            <span className="h-3 w-3 rounded-full" style={{ background: COMPOUND_COLORS[st.tyre] ?? "#7d8996" }} />
            {COMPOUND_ES[st.tyre] ?? st.tyre} {st.tyre_compound} · {st.tyre_age_laps} v
          </span>
        ) : null
      }
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <div className="flex flex-col justify-between py-4">
          <WheelStats s={s} wheel="front_left" />
          <WheelStats s={s} wheel="rear_left" />
        </div>
        <svg viewBox="0 0 200 400" className="h-72 w-auto sm:h-80" role="img" aria-label="Monoplaza visto desde arriba">
          {/* Front wing, split in halves for left/right damage */}
          <rect x={20} y={14} width={80} height={16} rx={4} fill={damageColor(d?.front_left_wing ?? 0)} />
          <rect x={100} y={14} width={80} height={16} rx={4} fill={damageColor(d?.front_right_wing ?? 0)} />
          {/* Nose and chassis */}
          <path d="M92 30 L108 30 L114 120 L86 120 Z" fill="#3a4655" />
          {/* Floor: the plank under the car, outlined around the sidepods */}
          <path
            d="M60 150 L140 150 L148 300 L136 330 L64 330 L52 300 Z"
            fill={damageColor(d?.floor ?? 0)}
            opacity={0.55}
          />
          {/* Sidepods */}
          <path d="M60 160 L84 150 L84 270 L64 290 Z" fill={damageColor(d?.sidepod ?? 0)} />
          <path d="M140 160 L116 150 L116 270 L136 290 Z" fill={damageColor(d?.sidepod ?? 0)} />
          {/* Engine cover */}
          <path d="M84 120 L116 120 L118 300 L100 330 L82 300 Z" fill="#46556a" />
          {/* Cockpit and halo */}
          <ellipse cx={100} cy={150} rx={13} ry={24} fill="#07090c" />
          <path d="M86 136 Q100 118 114 136" stroke="#9aa6b2" strokeWidth={4} fill="none" />
          {/* Diffuser and rear wing */}
          <rect x={68} y={330} width={64} height={18} rx={3} fill={damageColor(d?.diffuser ?? 0)} />
          <rect x={40} y={356} width={120} height={22} rx={4} fill={damageColor(d?.rear_wing ?? 0)} />
          {/* Suspension arms */}
          <line x1={50} y1={105} x2={90} y2={100} stroke="#3a4655" strokeWidth={4} />
          <line x1={150} y1={105} x2={110} y2={100} stroke="#3a4655" strokeWidth={4} />
          <line x1={46} y1={300} x2={84} y2={296} stroke="#3a4655" strokeWidth={4} />
          <line x1={154} y1={300} x2={116} y2={296} stroke="#3a4655" strokeWidth={4} />
          {/* Tyres and brakes */}
          {(Object.keys(TYRES) as Wheel[]).map((w) => {
            const t = TYRES[w];
            const temp = car?.tyres_surface_temperature_c[w];
            const brake = car?.brakes_temperature_c[w];
            const h = w.startsWith("front") ? 56 : 64;
            const bx = t.side === "left" ? t.x + TYRE_W + 6 : t.x - 6;
            return (
              <g key={w}>
                <rect x={t.x} y={t.y} width={TYRE_W} height={h} rx={9} fill={temp != null ? tyreTempColor(temp) : "#2a3441"} stroke="#07090c" strokeWidth={3} />
                {brake != null && <circle cx={bx} cy={t.y + h / 2} r={6} fill={brakeTempColor(brake)} />}
              </g>
            );
          })}
          {d && (
            <text x={100} y={228} textAnchor="middle" fontSize={13} fill="#e9eef3" className="num">
              {d.engine > 0 || d.gearbox > 0 ? `M ${d.engine}% · C ${d.gearbox}%` : ""}
            </text>
          )}
        </svg>
        <div className="flex flex-col justify-between py-4 text-right">
          <WheelStats s={s} wheel="front_right" />
          <WheelStats s={s} wheel="rear_right" />
        </div>
      </div>
      <Legend />
      {d && (d.drs_fault || d.ers_fault) && (
        <p className="mt-2 text-sm text-danger">
          {d.drs_fault && "Falla de DRS "}
          {d.ers_fault && "Falla de ERS"}
        </p>
      )}
    </Panel>
  );
}

function WheelStats({ s, wheel }: { s: Snapshot; wheel: Wheel }) {
  const wear = s.damage?.tyres_wear_percent[wheel];
  const car = s.car;
  return (
    <div className="space-y-0.5">
      {wear != null && (
        <div className={`num text-2xl font-semibold leading-none ${levelClass(wearLevel(wear))}`}>
          {wear.toFixed(0)}
          <span className="text-sm">%</span>
        </div>
      )}
      <div className="text-[0.65rem] uppercase tracking-wider text-muted">desgaste</div>
      {car && (
        <div className="num text-xs text-muted">
          <span className="text-fg">{car.tyres_surface_temperature_c[wheel]}°</span> / {car.tyres_inner_temperature_c[wheel]}°
          <br />
          {car.tyres_pressure_psi[wheel].toFixed(1)} psi · <span className="text-fg">{car.brakes_temperature_c[wheel]}°</span> fr
        </div>
      )}
    </div>
  );
}

function Legend() {
  const dot = (c: string) => <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />;
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[0.65rem] text-muted">
      <span className="flex items-center gap-1">{dot("#3b82f6")} frío</span>
      <span className="flex items-center gap-1">{dot("#34d399")} en ventana</span>
      <span className="flex items-center gap-1">{dot("#fbbf24")} caliente / daño</span>
      <span className="flex items-center gap-1">{dot("#f43f5e")} crítico</span>
    </div>
  );
}
