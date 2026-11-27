/** The still logo (the P as a track between the run-off and the ground). `data-brand-mark` is where the
 *  start-up intro lands when it finishes. */
export function LogoMark({ size = 28, className = "", target = false }: { size?: number; className?: string; target?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small static SVG, no optimisation to gain
    <img
      src="/brand/logo.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      data-brand-mark={target ? "" : undefined}
      className={`block shrink-0 rounded-[21.875%] ${className}`}
    />
  );
}
