"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "clasico" | "carbono" | "volante";

export const THEMES: { id: Theme; name: string; description: string; swatch: string[] }[] = [
  { id: "carbono", name: "Carbono", description: "Grafito, rojo de señal y números en cursiva.", swatch: ["#0b0c0e", "#14161a", "#ff4b2b", "#f2f3f5"] },
  { id: "clasico", name: "Clásico", description: "Muro de boxes oscuro con acento celeste.", swatch: ["#07090c", "#0e1217", "#22d3ee", "#e9eef3"] },
  { id: "volante", name: "Volante", description: "La pantalla de un volante: vidrio negro y números que brillan.", swatch: ["#030405", "#0b0d10", "#7dff6a", "#ffb547"] },
];

const KEY = "tema";
const EVENT = "tema-cambiado";

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "carbono" || v === "volante" || v === "clasico") return v;
  } catch {}
  return "carbono";
}

/** Runs before the page paints (inlined in <head>), so a stored theme never flashes the default. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${KEY}");if(t==="clasico"||t==="volante")document.documentElement.dataset.theme=t}catch(e){}`;

/** The player's theme, kept per device: a phone on the wheel and a tablet can differ. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("carbono");

  useEffect(() => {
    setThemeState(stored());
    const sync = () => setThemeState(stored());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {}
    if (t === "carbono") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    setThemeState(t);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { theme, setTheme };
}
