import type { Wheels } from "@/lib/types";

export const COMPOUND_ES: Record<string, string> = {
  Soft: "Blandos",
  Medium: "Medios",
  Hard: "Duros",
  Intermediate: "Intermedios",
  Wet: "Lluvia",
};

const COMPOUND_RING: Record<string, string> = {
  Soft: "var(--color-soft)",
  Medium: "var(--color-medium)",
  Hard: "var(--color-hard)",
  Intermediate: "var(--color-inter)",
  Wet: "var(--color-wet)",
};

/**
 * A compound as a little tyre: a coloured ring for a new set, filled when it is the
 * one on the car or already used. The name goes beside it only where it helps.
 */
export function TyreDot({ compound, size = 14, filled = false, title }: { compound: string | null | undefined; size?: number; filled?: boolean; title?: string }) {
  const c = (compound && COMPOUND_RING[compound]) || "var(--color-dim)";
  const label = title ?? (compound ? COMPOUND_ES[compound] ?? compound : "Goma desconocida");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-block shrink-0 rounded-full align-middle"
      style={{ width: size, height: size, boxSizing: "border-box", ...(filled ? { background: c } : { border: `${Math.max(2, Math.round(size / 5))}px solid ${c}` }) }}
    />
  );
}

/** Colour for a tyre from its surface temperature: cold blue, in window green, hot amber, overheated red. */
export function tyreColor(c: number | null | undefined): string {
  if (c == null) return "var(--color-line)";
  if (c < 70) return "#4ea8ff";
  if (c <= 100) return "var(--color-ok)";
  if (c <= 110) return "var(--color-warn)";
  return "var(--color-danger)";
}

/**
 * The car from above with its four tyres painted by temperature; the dark band at
 * the top of each tyre grows with wear. The signature drawing of the app.
 */
export function CarTyres({ temps, wear, className, label }: { temps?: Wheels | null; wear?: Wheels | null; className?: string; label?: string }) {
  const tyre = (x: number, y: number, w: number, h: number, t?: number, wr?: number) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={w / 3.5} fill={tyreColor(t)} />
      {wr != null && wr > 0 && <rect x={x} y={y} width={w} height={Math.max(2, (h * Math.min(wr, 100)) / 100)} rx={2} fill="#0b0c0e" opacity={0.6} />}
    </g>
  );
  return (
    <svg viewBox="0 0 140 280" className={className} role="img" aria-label={label ?? "Gomas"}>
      <rect x="22" y="8" width="96" height="12" rx="3" fill="var(--color-line)" />
      <path d="M63 20 H77 L80 84 H60 Z" fill="var(--color-line)" />
      <path d="M54 84 Q70 76 86 84 L98 150 Q101 200 86 236 H54 Q39 200 42 150 Z" fill="var(--color-line)" />
      <ellipse cx="70" cy="128" rx="9" ry="17" fill="var(--color-bg)" />
      <rect x="30" y="250" width="80" height="14" rx="3" fill="var(--color-line)" />
      {tyre(8, 34, 28, 52, temps?.front_left, wear?.front_left)}
      {tyre(104, 34, 28, 52, temps?.front_right, wear?.front_right)}
      {tyre(6, 176, 32, 60, temps?.rear_left, wear?.rear_left)}
      {tyre(102, 176, 32, 60, temps?.rear_right, wear?.rear_right)}
    </svg>
  );
}
