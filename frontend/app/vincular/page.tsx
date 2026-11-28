"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

import { LogoMark } from "@/components/brand/LogoMark";
import { RequireAuth } from "@/components/RequireAuth";
import { ROLES } from "@/components/settings/ScreensSection";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCockpits } from "@/lib/cockpit";

export default function LinkScreenPage() {
  return (
    <RequireAuth>
      <LinkScreen />
    </RequireAuth>
  );
}

const FIELD = "h-12 w-full rounded-[var(--radius-control)] border border-line bg-panel px-3 text-[1rem] text-fg focus:border-accent focus:outline-none";

/** The code inside what the QR holds (".../vincular?c=K7Q4MD") or what was typed. */
function codeFrom(text: string): string {
  try {
    const c = new URL(text).searchParams.get("c");
    if (c) return c.toUpperCase();
  } catch {}
  return text.replace(/[^0-9a-z]/gi, "").toUpperCase();
}

/**
 * The phone side of linking a screen: its name, the code it shows (scanned with the camera or typed)
 * and what it will show. The screen picks up its link by itself. On a computer, a guide sits beside it.
 */
function LinkScreen() {
  const { credentials } = useAuth();
  const { cockpits } = useCockpits();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState("tabla");
  const [cockpit, setCockpit] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setCode(c.toUpperCase());
    setPhone(window.matchMedia("(pointer: coarse)").matches && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await api("/api/screens/pair/confirm", await credentials(), {
        method: "POST",
        body: { code: codeFrom(code), role, name: name.trim() || "Pantalla", config: role === "cockpit" ? { cockpit: cockpit ?? cockpits?.[0]?.id } : {} },
      });
      setState("done");
    } catch (err) {
      setState("idle");
      setError(
        err instanceof ApiError && err.status === 404
          ? "Ese código no está en ninguna pantalla ahora. Puede haber vencido: mirá el que muestra la pantalla."
          : err instanceof ApiError && err.status === 402
            ? "Como Piloto rookie tenés 1 pantalla vinculada. Eliminá la otra en Ajustes, o convertite en Piloto profesional para tener todas las que quieras."
            : "No se pudo vincular. Probá de nuevo.",
      );
    }
  };

  if (state === "done")
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-[max(1rem,env(safe-area-inset-left))] py-8">
        <span className="eyebrow">Pantalla vinculada</span>
        <h1 className="display text-[2.4rem] uppercase leading-none">Listo</h1>
        <p className="text-[1rem] text-soft-fg">
          {name.trim() || "La pantalla"} ya muestra {ROLES.find((r) => r.id === role)?.name.toLowerCase()}. Le podés cambiar lo que muestra cuando quieras desde Ajustes.
        </p>
        <Link href="/settings#pantallas" className="btn-primary grid h-12 place-items-center text-[1.05rem]">Ver tus pantallas</Link>
      </main>
    );

  return (
    <main className="mx-auto grid max-w-[1100px] gap-10 px-[max(1rem,env(safe-area-inset-left))] py-6 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:gap-14 lg:py-10">
      <form onSubmit={send} className="flex flex-col gap-6">
        <div>
          <Link href="/settings#pantallas" className="text-[0.9rem] text-muted">‹ Ajustes</Link>
          <span className="eyebrow mt-4 block">Nueva pantalla</span>
          <h1 className="display mt-1 text-[2.2rem] uppercase leading-none">Vinculá una pantalla</h1>
        </div>

        <Step n={1} title="Ponele un nombre">
          <label className="sr-only" htmlFor="nombre-pantalla">Nombre de la pantalla</label>
          <input id="nombre-pantalla" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Ej.: Tele del living" className={FIELD} />
        </Step>

        <Step n={2} title="Escribí el código que muestra la pantalla">
          <label className="sr-only" htmlFor="codigo">Código</label>
          <input
            id="codigo"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            minLength={6}
            placeholder="K7Q·4MD"
            autoCapitalize="characters"
            autoComplete="off"
            className={`${FIELD} font-mono text-[1.4rem] tracking-[0.14em]`}
          />
          {phone && (
            <button type="button" onClick={() => setScanning(true)} className="btn flex h-12 items-center justify-center gap-2 text-[0.98rem]">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" />
              </svg>
              Escanear el QR con la cámara
            </button>
          )}
        </Step>

        <Step n={3} title="Elegí qué va a mostrar">
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Qué muestra la pantalla</legend>
            {ROLES.map((r) => (
              <label key={r.id} className={`flex cursor-pointer gap-3 rounded-[12px] px-3.5 py-3 ${role === r.id ? "bg-accent/10 ring-2 ring-accent" : "bg-panel ring-1 ring-line"}`}>
                <input type="radio" name="rol" value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} className="mt-1 accent-[var(--color-accent)]" />
                <span className="min-w-0">
                  <span className="block font-semibold">{r.name}</span>
                  <span className="block text-[0.82rem] text-muted">{r.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {role === "cockpit" && cockpits && (
            <label className="flex flex-col gap-1.5 text-[0.85rem] text-muted">
              Qué cockpit
              <select value={cockpit ?? cockpits[0].id} onChange={(e) => setCockpit(e.target.value)} className={FIELD}>
                {cockpits.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
        </Step>

        {error && <p className="text-[0.9rem] text-warn" role="alert">{error}</p>}
        <button type="submit" disabled={state === "sending"} className="btn-primary h-12 text-[1.1rem]">
          {state === "sending" ? "Vinculando…" : "Vincular pantalla"}
        </button>
      </form>

      <Guide />

      {scanning && (
        <Scanner
          onCode={(c) => {
            setCode(c);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="flex items-center gap-2.5 font-semibold">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[0.78rem] font-bold text-accent-fg">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** On a computer: how to get the code, and what the screen looks like while it waits. */
function Guide() {
  const [qr, setQr] = useState<string | null>(null);
  const [host, setHost] = useState("");
  useEffect(() => {
    setHost(window.location.host);
    void QRCode.toDataURL(`${window.location.origin}/vincular?c=K7Q4MD`, { margin: 1, width: 240, color: { dark: "#0b0c0e", light: "#f2f3f5" } }).then(setQr);
  }, []);
  return (
    <aside className="hidden flex-col gap-5 lg:sticky lg:top-24 lg:flex lg:self-start" aria-label="Cómo vincular una pantalla">
      <div className="card flex flex-col gap-4 p-5">
        <h2 className="title text-[1.2rem]">Cómo conseguir el código</h2>
        <ol className="flex flex-col gap-3 text-[0.95rem] text-soft-fg">
          <li className="flex gap-3">
            <span className="font-mono text-dim">1</span>
            <span>
              En la tele, la tablet o la otra compu, abrí el navegador y entrá a <b className="text-fg">{host || "…"}/pantalla</b>.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-dim">2</span>
            <span>Te muestra un QR y un código como estos. Escaneá el QR con la cámara del celular, o escribí el código acá.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-dim">3</span>
            <span>Elegí qué querés ver y tocá Vincular: la pantalla cambia sola. No hace falta iniciar sesión en ella.</span>
          </li>
        </ol>
      </div>

      {/* what the screen shows while it waits, drawn small */}
      <figure className="flex flex-col gap-2">
        <div className="rounded-[18px] border-[10px] border-panel-2 bg-bg p-6 shadow-lg">
          <div className="grid grid-cols-[1fr_auto] items-center gap-6">
            <div className="flex flex-col gap-2">
              <span className="display flex items-center gap-1.5 text-[0.8rem]"><LogoMark size={16} />PIT EN LÍNEA</span>
              <span className="display text-[1.5rem] uppercase leading-[0.95]">Sumá esta pantalla a tu box</span>
              <span className="text-[0.72rem] text-dim">Escaneá el código con tu celular o escribilo en la app</span>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <div className="paper p-2">{qr ? <img src={qr} alt="" className="h-24 w-24" /> : <div className="h-24 w-24" />}</div>
              <span className="font-mono text-[1.1rem] tracking-[0.12em]">K7Q·4MD</span>
            </div>
          </div>
        </div>
        <div className="mx-auto h-3 w-24 rounded-b-[6px] bg-panel-2" aria-hidden="true" />
        <figcaption className="text-center text-[0.82rem] text-dim">Así se ve la pantalla esperando que la vincules (ejemplo)</figcaption>
      </figure>
    </aside>
  );
}

/** The phone's camera reading the screen's QR. */
function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const found = useRef(onCode);
  found.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    (async () => {
      try {
        const jsQR = (await import("jsqr")).default;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = () => {
          const v = video.current;
          if (stopped || !v || !ctx) return;
          if (v.videoWidth) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const qr = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            const c = qr ? codeFrom(qr.data) : "";
            if (c.length >= 6) {
              navigator.vibrate?.(60);
              found.current(c);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError("No pude abrir la cámara. Dale permiso en el navegador, o escribí el código a mano.");
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label="Escanear el QR">
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-[min(70vw,320px)] w-[min(70vw,320px)] rounded-[24px] border-4 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
        </div>
        <p className="absolute inset-x-0 top-[max(1.5rem,env(safe-area-inset-top))] px-6 text-center text-[1rem] text-white">
          {error ?? "Apuntá al QR que muestra la pantalla"}
        </p>
      </div>
      <div className="bg-black px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={onClose} className="btn h-12 w-full text-[1rem] text-white">
          Cancelar
        </button>
      </div>
    </div>
  );
}
