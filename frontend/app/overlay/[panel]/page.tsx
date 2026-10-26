"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Overlay } from "@/components/overlay/Overlay";

// /overlay/<panel>?t=rbo_...&escala=1&opacidad=80 — a single transparent panel for
// OBS (browser source) or the bridge's floating windows on Windows.
export default function OverlayPage() {
  return (
    <Suspense>
      <OverlayFromUrl />
    </Suspense>
  );
}

function OverlayFromUrl() {
  const { panel } = useParams<{ panel: string }>();
  const q = useSearchParams();
  const number = (key: string, fallback: number, min: number, max: number) => {
    const v = Number(q.get(key));
    return Number.isFinite(v) && q.get(key) ? Math.min(max, Math.max(min, v)) : fallback;
  };
  return (
    <Overlay
      panel={panel}
      token={q.get("t") ?? ""}
      scale={number("escala", 1, 0.5, 3)}
      opacity={number("opacidad", 80, 0, 100) / 100}
      rows={number("filas", 0, 0, 24)}
      voice={q.get("voz") === "1"}
    />
  );
}
