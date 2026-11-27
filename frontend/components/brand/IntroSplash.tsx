"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { INTRO_SEEN_KEY as SEEN_KEY, INTRO_SKIP as SKIP } from "@/lib/appRoutes";
import { introModel, type IntroData } from "@/lib/brand/intro";
import { DARK, FG, RED, carSvg, loadBrand, marksGradient, prefersReducedMotion } from "@/lib/brand/scene";

const LAND_MS = 750; // the flight from the middle of the screen to the logo in the header

function seen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The start-up intro: start lights, the cars on the run up to the P inside the logo's square, and when the
 * logo is formed it flies to the logo in the header ([data-brand-mark]). Once per session; skippable;
 * not shown with reduced motion. It takes over the start-up loading (see INTRO_BOOT). When the browser
 * refuses sound until a tap, it waits for one ("Tocá para largar") so the start always has its sound.
 */
export function IntroSplash() {
  const [phase, setPhase] = useState<"off" | "play" | "land">("off");
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [waitTap, setWaitTap] = useState(false);
  const startClockRef = useRef<() => void>(() => {});
  const startWithTapRef = useRef<() => void>(() => {});
  const overlayRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gantryRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startRef = useRef(0);
  const landRef = useRef<() => void>(() => {});

  const path = usePathname() || "/";
  useEffect(() => {
    const html = document.documentElement;
    if (seen() || prefersReducedMotion() || SKIP.some((p) => path.startsWith(p))) {
      html.classList.remove("intro-boot");
      return;
    }
    setPhase("play");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- decided once, at start-up

  const finish = useCallback(() => {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
    document.documentElement.classList.remove("intro-playing", "intro-boot");
    setPhase("off");
  }, []);

  // fly the square into the header's logo, fading the dark around it
  const land = useCallback(() => {
    const win = winRef.current;
    const overlay = overlayRef.current;
    if (!win || !overlay) return finish();
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-brand-mark]")).find((e) => e.getBoundingClientRect().width > 0);
    setPhase("land");
    const from = win.getBoundingClientRect();
    if (target) {
      const to = target.getBoundingClientRect();
      const scale = to.width / from.width;
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      win.style.transition = `transform ${LAND_MS}ms cubic-bezier(.2,.75,.25,1)`;
      win.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    } else {
      win.style.transition = `opacity ${LAND_MS}ms ease`;
      win.style.opacity = "0";
    }
    overlay.style.transition = `background-color ${LAND_MS}ms ease`;
    overlay.style.backgroundColor = "rgba(20,22,26,0)";
    window.setTimeout(finish, LAND_MS + 30);
  }, [finish]);
  landRef.current = land;

  useEffect(() => {
    if (phase !== "play") return;
    document.documentElement.classList.add("intro-playing");
    document.documentElement.classList.remove("intro-boot"); // the overlay is up now
    let raf = 0;
    let alive = true;
    const audio = new Audio("/brand/intro-audio.mp3");
    audio.preload = "auto";
    audioRef.current = audio;

    loadBrand<IntroData>("/brand/intro.json")
      .then((D) => {
        const svg = svgRef.current;
        if (!alive || !svg) return;
        const m = introModel(D);
        const L = D.logo;
        const [sx1, sy1, sx2] = D.startLine;
        svg.innerHTML = `
          <defs>
            <clipPath id="introTile"><rect width="256" height="256" rx="56"/></clipPath>
            ${marksGradient("introMarks", L.markEnds)}
            <pattern id="introChk" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="${FG}"/><rect width="3" height="3" fill="#0b0c0e"/><rect x="3" y="3" width="3" height="3" fill="#0b0c0e"/></pattern>
          </defs>
          <g class="world" opacity="0">
            <path fill="${RED}" fill-rule="evenodd" clip-path="url(#introTile)" d="M-100 -100H400V400H-100Z ${L.inside}"/>
            <path fill="${FG}" d="${D.loopRibbon}"/>
            <path fill="${FG}" d="${L.ribbon}"/>
            <path fill="${RED}" d="${D.loopKerbRed}"/><path fill="${FG}" d="${D.loopKerbWhite}"/>
            <path fill="${RED}" d="${L.kerbRed}"/><path fill="${FG}" d="${L.kerbWhite}"/>
            <rect x="${sx1}" y="${sy1 - 3}" width="${sx2 - sx1}" height="6" fill="url(#introChk)"/>
          </g>
          <g class="marks">${L.marks
            .map((d) => `<path d="${d}" pathLength="1" fill="none" stroke="url(#introMarks)" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="1 1" stroke-dashoffset="1"/>`)
            .join("")}</g>
          ${[2, 1, 0].map((k) => `<g class="car" data-k="${k}" opacity="0">${carSvg(k)}</g>`).join("")}`;
        const world = svg.querySelector<SVGGElement>(".world")!;
        const marks = Array.from(svg.querySelectorAll<SVGPathElement>(".marks path"));
        const cars: SVGGElement[] = [];
        svg.querySelectorAll<SVGGElement>(".car").forEach((g) => (cars[Number(g.dataset.k)] = g));
        const pods = Array.from(gantryRef.current?.children ?? []) as HTMLElement[];
        const tick = (now: number) => {
          const t = (now - startRef.current) / 1000;
          const c = m.camera(t);
          svg.setAttribute("viewBox", `${(c.x - c.h / 2).toFixed(2)} ${(c.y - c.h / 2).toFixed(2)} ${c.h.toFixed(2)} ${c.h.toFixed(2)}`);
          if (gantryRef.current) gantryRef.current.style.opacity = m.gantry(t).toFixed(3);
          pods.forEach((p, i) => p.classList.toggle("on", m.lampOn(i, t)));
          world.setAttribute("opacity", m.solid(t).toFixed(3));
          let reveal = 0;
          cars.forEach((g, k) => {
            const s = m.car(k, t);
            g.setAttribute("transform", `translate(${s.x.toFixed(2)} ${s.y.toFixed(2)}) rotate(${s.a.toFixed(1)})`);
            g.setAttribute("opacity", s.op.toFixed(3));
            if (k === 2) reveal = s.reveal; // the marks are the last car's
          });
          marks.forEach((p) => p.setAttribute("stroke-dashoffset", (1 - reveal).toFixed(3)));
          if (t >= m.T_GONE + 0.1) {
            landRef.current();
            return;
          }
          raf = requestAnimationFrame(tick);
        };
        // the picture starts with the sound (or without it, if the visitor never allows it)
        let started = false;
        startClockRef.current = () => {
          if (started || !alive) return;
          started = true;
          setWaitTap(false);
          startRef.current = performance.now();
          raf = requestAnimationFrame(tick);
        };
        // Browsers refuse sound until the visitor has touched the page. Try; if refused, the intro
        // waits on the dark screen for a tap ("Tocá para largar") and that tap starts it with sound.
        let settled = false;
        const refused = () => {
          if (settled || !alive) return;
          settled = true;
          audio.pause();
          setWaitTap(true);
        };
        const timer = window.setTimeout(refused, 1200); // some browsers leave play() pending
        const p = audio.play();
        if (p && p.then)
          p.then(() => {
            window.clearTimeout(timer);
            if (settled) return audio.pause();
            settled = true;
            startClockRef.current();
          }).catch(() => {
            window.clearTimeout(timer);
            refused();
          });
      })
      .catch(() => finish());
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      audio.pause();
    };
  }, [phase === "play", finish]); // eslint-disable-line react-hooks/exhaustive-deps

  // the tap that starts the intro: play inside the gesture (what phones require), the clock on "playing"
  const startWithTap = () => {
    if (!waitTap) return;
    const audio = audioRef.current;
    setWaitTap(false);
    if (!audio) return startClockRef.current();
    try {
      if (audio.readyState > 0) audio.currentTime = 0;
    } catch {}
    audio.addEventListener("playing", () => startClockRef.current(), { once: true });
    const p = audio.play();
    if (p && p.catch)
      p.catch(() => {
        setSoundBlocked(true);
        startClockRef.current();
      });
    window.setTimeout(() => startClockRef.current(), 1500); // a slow network never holds the picture
  };

  // the sound was refused even after the tap: the button starts it, in step with the picture
  const enableSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setSoundBlocked(false);
    const seek = () => {
      try {
        audio.currentTime = Math.max(0, (performance.now() - startRef.current) / 1000);
      } catch {}
    };
    const p = audio.play();
    if (audio.readyState > 0) seek();
    else audio.addEventListener("loadedmetadata", seek, { once: true });
    if (p && p.catch) p.catch(() => setSoundBlocked(true));
  };

  const skip = () => {
    const audio = audioRef.current;
    if (audio) {
      let v = audio.volume;
      const fade = window.setInterval(() => {
        v = Math.max(0, v - 0.1);
        audio.volume = v;
        if (v <= 0) {
          audio.pause();
          window.clearInterval(fade);
        }
      }, 40);
    }
    land();
  };

  // a key works as the tap on a computer
  useEffect(() => {
    if (!waitTap) return;
    const onKey = () => startWithTapRef.current();
    window.addEventListener("keydown", onKey, { once: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [waitTap]);
  startWithTapRef.current = startWithTap;

  if (phase === "off") return null;
  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-[100] flex items-center justify-center ${waitTap ? "cursor-pointer" : ""}`}
      style={{ backgroundColor: DARK }}
      onClick={startWithTap}
    >
      <div
        ref={winRef}
        aria-hidden="true"
        className="intro-win relative aspect-square w-[min(66vmin,460px)] overflow-hidden rounded-[21.875%]"
        style={{ backgroundColor: DARK, transformOrigin: "center", containerType: "inline-size" }}
      >
        <div ref={gantryRef} className="intro-gantry" style={{ opacity: 0 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} />
          ))}
        </div>
        <svg ref={svgRef} viewBox="0 0 256 256" className="absolute inset-0 h-full w-full" />
      </div>
      {phase === "play" && waitTap && (
        <p className="intro-tap pointer-events-none animate-pulse absolute inset-x-0 top-[calc(50%+min(33vmin,230px)+1.5rem)] text-center text-[1rem] font-semibold uppercase tracking-[0.18em] text-[#f2f3f5]">
          {typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? "Tocá para largar" : "Hacé clic para largar"}
        </p>
      )}
      {phase === "play" && (
        <div className="absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] flex justify-center gap-3">
          {soundBlocked && (
            <button type="button" className="btn px-4 py-2 text-[0.9rem]" onClick={(e) => {
                e.stopPropagation();
                enableSound();
              }}>
              Activar sonido
            </button>
          )}
          <button type="button" className="btn px-4 py-2 text-[0.9rem] text-muted" onClick={(e) => {
              e.stopPropagation();
              skip();
            }}>
            Saltar
          </button>
        </div>
      )}
    </div>
  );
}
