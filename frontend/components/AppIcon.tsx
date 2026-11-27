import { LOGO_ROUNDED, LOGO_SQUARE } from "@/components/brand/logoData";

/** The app icon: the logo. Rounded for the browser tab; square where the system rounds it (home screen, PWA). */
export function AppIcon({ size, rounded = false }: { size: number; rounded?: boolean }) {
  return (
    <div style={{ width: size, height: size, display: "flex", background: rounded ? "transparent" : "#14161a" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered by ImageResponse, not the browser */}
      <img src={rounded ? LOGO_ROUNDED : LOGO_SQUARE} width={size} height={size} alt="" />
    </div>
  );
}
