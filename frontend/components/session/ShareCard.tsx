"use client";

import { useEffect, useRef, useState } from "react";

import { useTrackLayout } from "@/components/ui/TrackOutline";
import { WEATHER_ES } from "@/lib/format";
import { circuitName, gpName } from "@/lib/gp";
import { lapS, sessionEs, type Summary } from "@/lib/sessions";
import type { TrackLayout } from "@/lib/types";

const ACCENT = "#ff4b2b";
const BACKGROUNDS = [
  { id: "paneo", label: "Paneo", src: "/compartir/paneo.jpg" },
  { id: "frente", label: "De frente", src: "/compartir/frente.jpg" },
  { id: "baja", label: "Atardecer", src: "/compartir/baja.jpg" },
  { id: "circuito", label: "Circuito", src: null },
] as const;
const FORMATS = { historia: { w: 1080, h: 1920, label: "Historia" }, post: { w: 1080, h: 1350, label: "Post" } } as const;
type Format = keyof typeof FORMATS;

function cssFont(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** The outline scaled into a box; returns false when there is no outline yet. */
function outline(ctx: CanvasRenderingContext2D, layout: TrackLayout | null, x: number, y: number, w: number, h: number) {
  const pts = layout?.segments.flat() ?? [];
  if (pts.length < 2) return false;
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const s = Math.min(w / (maxX - minX || 1), h / (maxZ - minZ || 1));
  const ox = x + (w - (maxX - minX) * s) / 2, oz = y + (h - (maxZ - minZ) * s) / 2;
  ctx.beginPath();
  for (const seg of layout!.segments) seg.forEach(([px, pz], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ox + (px - minX) * s, oz + (pz - minZ) * s));
  return true;
}

/** Shrinks the font until the text fits the width. */
function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, px: number, max: number) {
  ctx.font = font(px);
  while (px > 20 && ctx.measureText(text).width > max) ctx.font = font((px -= 4));
  return px;
}

type CardData = { summary: Summary; layout: TrackLayout | null };

function draw(canvas: HTMLCanvasElement, format: Format, bg: HTMLImageElement | null, { summary: s, layout }: CardData) {
  const { w: W, h: H } = FORMATS[format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const disp = cssFont("--font-saira-condensed", "sans-serif");
  const mono = cssFont("--font-jetbrains", "monospace");
  const sans = cssFont("--font-barlow", "sans-serif");
  const D = (px: number) => `italic 800 ${px}px ${disp}`;
  const M = (px: number) => `500 ${px}px ${mono}`;
  const pad = 76;
  const story = format === "historia";
  const t = s.tarjeta;

  // Background, then darkened top and bottom so the text always reads.
  ctx.fillStyle = "#0b0c0e";
  ctx.fillRect(0, 0, W, H);
  if (bg) cover(ctx, bg, W, H);
  else {
    const g = ctx.createRadialGradient(W * 0.6, H * 0.42, 40, W * 0.6, H * 0.42, H * 0.7);
    g.addColorStop(0, "#2a1410");
    g.addColorStop(1, "#0b0c0e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W * 0.5, H * 0.42);
    ctx.rotate(-0.12);
    if (outline(ctx, layout, -W * 0.55, -H * 0.2, W * 1.1, H * 0.4)) {
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 46;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,75,43,0.5)";
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    ctx.restore();
  }
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  top.addColorStop(0, "rgba(5,6,7,0.85)");
  top.addColorStop(1, "rgba(5,6,7,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.4);
  const bot = ctx.createLinearGradient(0, H * (story ? 0.5 : 0.38), 0, H);
  bot.addColorStop(0, "rgba(5,6,7,0)");
  bot.addColorStop(0.45, "rgba(5,6,7,0.82)");
  bot.addColorStop(1, "rgba(5,6,7,0.96)");
  ctx.fillStyle = bot;
  ctx.fillRect(0, H * 0.38, W, H * 0.62);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f2f3f5";
  ctx.letterSpacing = "0px";

  // Top: session, grand prix, circuit.
  const date = new Date(s.sesion.inicio).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
  ctx.font = M(28);
  ctx.letterSpacing = "5px";
  ctx.fillStyle = ACCENT;
  const eyebrow = `${sessionEs(s.sesion.tipo).toUpperCase()}`;
  ctx.fillText(eyebrow, pad, pad + 26);
  const ew = ctx.measureText(eyebrow).width;
  ctx.fillStyle = "rgba(242,243,245,0.72)";
  ctx.fillText(`  ·  ${date.toUpperCase()}`, pad + ew, pad + 26);
  ctx.letterSpacing = "0px";
  const gp = gpName(s.sesion.track_id);
  let y = pad + 26;
  ctx.fillStyle = "#f2f3f5";
  if (gp) {
    ctx.font = D(story ? 58 : 50);
    y += story ? 84 : 72;
    ctx.fillText("GRAN PREMIO DE", pad, y);
    const px = fit(ctx, gp.toUpperCase(), D, story ? 168 : 136, W - 2 * pad);
    y += px * 0.92;
    ctx.fillText(gp.toUpperCase(), pad - 4, y);
  } else {
    const px = fit(ctx, (s.sesion.pista ?? "").toUpperCase(), D, story ? 150 : 120, W - 2 * pad);
    y += px;
    ctx.fillText((s.sesion.pista ?? "").toUpperCase(), pad, y);
  }
  ctx.font = M(30);
  ctx.letterSpacing = "3px";
  ctx.fillStyle = "rgba(242,243,245,0.8)";
  ctx.fillText((circuitName(s.sesion.track_id, s.sesion.pista) ?? "").toUpperCase(), pad, y + 56);
  ctx.letterSpacing = "0px";

  // Bottom up: footer, stats, then the result with the track beside it.
  const foot = H - pad;
  ctx.fillStyle = "#f2f3f5";
  fit(ctx, t.nombre, (px) => `italic 700 ${px}px ${disp}`, 52, W * 0.55);
  ctx.fillText(t.nombre, pad, foot);
  ctx.font = M(24);
  ctx.letterSpacing = "4px";
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(242,243,245,0.75)";
  ctx.fillText("INGENIERO DE PISTA", W - pad, foot - 8);
  const bw = ctx.measureText("INGENIERO DE PISTA").width;
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(W - pad - bw - 22, foot - 17, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.letterSpacing = "0px";
  const lineY = foot - 78;
  ctx.fillStyle = "rgba(242,243,245,0.22)";
  ctx.fillRect(pad, lineY, W - 2 * pad, 2);

  const race = s.carrera || (s.sesion.tipo ?? "").toLowerCase().includes("qualif") || (s.sesion.tipo ?? "").toLowerCase().includes("shootout");
  const hero = race && s.resultado != null;
  const weather = t.clima ? (WEATHER_ES[t.clima] ?? t.clima) : null;
  const stats: [string, string][] = [];
  if (hero) stats.push(["MEJOR VUELTA", lapS(s.mejor_vuelta_s)]);
  stats.push(["VUELTAS", String(s.vueltas)]);
  if (weather) stats.push(["CLIMA", t.temp_pista != null ? `${weather} · pista ${t.temp_pista}°` : weather]);
  if (stats.length < 3 && t.equipo) stats.push(["EQUIPO", t.equipo]);
  const colW = (W - 2 * pad) / stats.length;
  const valY = lineY - 44;
  stats.forEach(([label, value], i) => {
    const x = pad + i * colW;
    ctx.font = M(22);
    ctx.letterSpacing = "4px";
    ctx.fillStyle = "rgba(242,243,245,0.6)";
    ctx.fillText(label, x, valY - 70);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = "#f2f3f5";
    fit(ctx, value, (px) => `italic 700 ${px}px ${disp}`, 66, colW - 24);
    ctx.fillText(value, x, valY);
  });

  const heroBase = valY - 150;
  const trackBox = { w: story ? 400 : 340, h: story ? 300 : 250 };
  ctx.save();
  // With the circuit as the background the small one would only repeat it.
  if (bg && outline(ctx, layout, W - pad - trackBox.w, heroBase - trackBox.h, trackBox.w, trackBox.h)) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 24;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#f2f3f5";
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "#f2f3f5";
  if (hero) {
    const big = story ? 300 : 250;
    ctx.font = D(big);
    const label = `P${s.resultado}`;
    ctx.fillText(label, pad - 10, heroBase);
    const lw = ctx.measureText(label).width;
    ctx.font = `600 ${story ? 36 : 32}px ${sans}`;
    ctx.fillStyle = "rgba(242,243,245,0.8)";
    const lines = [
      t.pilotos ? `de ${t.pilotos}` : null,
      s.largada ? `largó ${s.largada}°${s.largada > s.resultado! ? `  ▲${s.largada - s.resultado!}` : ""}` : null,
    ].filter(Boolean) as string[];
    lines.forEach((l, i) => ctx.fillText(l, pad + lw + 18, heroBase - 26 - (lines.length - 1 - i) * 48));
  } else {
    ctx.font = M(24);
    ctx.letterSpacing = "4px";
    ctx.fillStyle = "rgba(242,243,245,0.6)";
    ctx.fillText("MEJOR VUELTA", pad, heroBase - (story ? 190 : 160));
    ctx.letterSpacing = "0px";
    ctx.fillStyle = "#f2f3f5";
    fit(ctx, lapS(s.mejor_vuelta_s), D, story ? 190 : 160, W - 2 * pad - trackBox.w - 20);
    ctx.fillText(lapS(s.mejor_vuelta_s), pad - 6, heroBase);
  }
}

/** The session card to post: Strava-style, the result over a background picked here or a photo of your own. */
export function ShareCard({ summary, onClose }: { summary: Summary; onClose: () => void }) {
  const layout = useTrackLayout(summary.sesion.track_id);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [format, setFormat] = useState<Format>("historia");
  const [bgId, setBgId] = useState<string>("paneo");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    (async () => {
      await document.fonts.ready;
      const src = bgId === "foto" ? photo : BACKGROUNDS.find((b) => b.id === bgId)?.src ?? null;
      const img = src ? await loadImage(src).catch(() => null) : null;
      if (!gone && canvas.current) draw(canvas.current, format, img, { summary, layout });
    })();
    return () => {
      gone = true;
    };
  }, [format, bgId, photo, summary, layout]);

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo);
  }, [photo]);

  const fileName = `${(gpName(summary.sesion.track_id) ?? summary.sesion.pista ?? "sesion").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${format}.png`;

  const share = async () => {
    if (!canvas.current) return;
    setBusy(true);
    setNote(null);
    try {
      const blob = await new Promise<Blob | null>((r) => canvas.current!.toBlob(r, "image/png"));
      if (!blob) throw new Error("no image");
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] }).catch(() => undefined);
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        setNote("Listo, la imagen quedó en tus descargas.");
      }
    } catch {
      setNote("No se pudo armar la imagen. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg/95 backdrop-blur" role="dialog" aria-label="Compartir la sesión">
      <div className="mx-auto flex min-h-dvh max-w-[980px] flex-col gap-5 px-4 py-5 lg:flex-row lg:items-start lg:gap-8 lg:py-10">
        <div className="flex justify-center lg:flex-1">
          <canvas
            ref={canvas}
            className="h-auto max-h-[62dvh] w-auto max-w-full rounded-[14px] shadow-2xl lg:max-h-[86dvh]"
            style={{ aspectRatio: `${FORMATS[format].w} / ${FORMATS[format].h}` }}
          />
        </div>
        <div className="flex flex-col gap-5 lg:w-[320px]">
          <div className="flex items-center justify-between">
            <span className="title text-[1.2rem]">Compartir</span>
            <button type="button" onClick={onClose} className="text-muted hover:text-fg" aria-label="Cerrar">
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <span className="eyebrow">Formato</span>
            <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-panel-2 p-1">
              {(Object.keys(FORMATS) as Format[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={format === f}
                  onClick={() => setFormat(f)}
                  className={`title rounded-[calc(var(--radius-control)-2px)] py-2 text-[0.9rem] ${format === f ? "bg-fg text-bg" : "text-muted"}`}
                >
                  {FORMATS[f].label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="eyebrow">Fondo</span>
            <div className="grid grid-cols-5 gap-2">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={bgId === b.id}
                  onClick={() => setBgId(b.id)}
                  className={`flex flex-col items-center gap-1 text-[0.72rem] ${bgId === b.id ? "text-fg" : "text-muted"}`}
                >
                  <span
                    className={`block aspect-[3/4] w-full rounded-lg bg-[#0b0c0e] bg-cover bg-center ${bgId === b.id ? "ring-2 ring-accent" : "ring-1 ring-line"}`}
                    style={b.src ? { backgroundImage: `url(${b.src})` } : undefined}
                  >
                    {!b.src && <span className="flex h-full items-center justify-center text-accent">◠</span>}
                  </span>
                  {b.label}
                </button>
              ))}
              <label className={`flex cursor-pointer flex-col items-center gap-1 text-[0.72rem] ${bgId === "foto" ? "text-fg" : "text-muted"}`}>
                <span
                  className={`flex aspect-[3/4] w-full items-center justify-center rounded-lg bg-panel-2 bg-cover bg-center text-[1.2rem] ${bgId === "foto" ? "ring-2 ring-accent" : "ring-1 ring-line"}`}
                  style={photo ? { backgroundImage: `url(${photo})` } : undefined}
                >
                  {!photo && "+"}
                </span>
                Tu foto
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setPhoto(URL.createObjectURL(f));
                    setBgId("foto");
                  }}
                />
              </label>
            </div>
            <p className="text-[0.8rem] text-muted">Desde el celular podés sacar la foto en el momento: una de tu butaca, el volante o la pantalla.</p>
          </div>
          <button type="button" onClick={() => void share()} disabled={busy} className="btn-primary px-5 py-3.5 disabled:opacity-50">
            {busy ? "Armando…" : "Compartir imagen"}
          </button>
          {note && <p className="text-[0.85rem] text-muted">{note}</p>}
        </div>
      </div>
    </div>
  );
}
