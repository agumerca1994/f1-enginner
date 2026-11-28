// Shared pieces of the Ajustes screen: one size for every input and select, one header per section.

/** Inputs and selects: all the same height and width, so the rows line up. */
export const CONTROL =
  "h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 text-[0.95rem] text-fg focus:border-accent focus:outline-none";

/** The button beside a control (Guardar, Probar): a fixed width, so the controls end at the same place. */
export const SIDE_BUTTON = "btn h-11 w-28 shrink-0 text-[0.92rem] disabled:opacity-40";

/** A section's header: what it is, one line on what for, and an action on the right. */
export function Sub({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h3 className="title text-[1.15rem]">{title}</h3>
        {hint && <p className="text-[0.88rem] text-muted">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
