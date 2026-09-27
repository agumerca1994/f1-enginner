const STALE_AFTER_S = 3;

/** A dashboard card. When its data is old it says so instead of pretending to be live. */
export function Panel({
  title,
  age,
  className = "",
  children,
  right,
}: {
  title: string;
  age?: number | null;
  className?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const stale = age != null && age > STALE_AFTER_S;
  return (
    <section
      className={`rounded-2xl border border-line bg-panel p-4 transition-opacity ${stale ? "opacity-60" : ""} ${className}`}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="label">{title}</h2>
        <div className="flex items-center gap-2">
          {stale && <span className="num text-[0.68rem] text-warn">hace {Math.round(age!)}s</span>}
          {right}
        </div>
      </header>
      {children}
    </section>
  );
}

export function Empty({ children = "Esperando datos…" }: { children?: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Bar({ value, className = "bg-accent" }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2">
      <div className={`h-full rounded-full transition-[width] duration-150 ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
