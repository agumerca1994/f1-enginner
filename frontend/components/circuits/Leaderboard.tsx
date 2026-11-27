"use client";

import { useEffect, useState } from "react";

import type { GroupRow } from "@/lib/groups";
import { lapS, useApi } from "@/lib/sessions";
import { LoadingScreen } from "@/components/brand/LogoLoader";

type Row = { pos: number; nombre: string; tiempo_ms: number; sectores_ms: number[]; dif_ms: number | null; equipo: string | null; fecha: string | null; soy_yo: boolean };
type Board = {
  juego: number | null;
  juego_nombre: string | null;
  opciones: { juego: number; juego_nombre: string; categoria: string; clima: string; pilotos: number }[];
  pilotos: number;
  filas: Row[];
  yo: Row | null;
};

const gap = (ms: number | null) => (ms == null || ms === 0 ? "—" : `+${(ms / 1000).toFixed(3).replace(".", ",")}`);

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex rounded-[8px] bg-bg p-[3px]" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`h-7 rounded-[6px] px-3 text-[0.82rem] ${value === v ? "bg-fg font-semibold text-bg" : "text-muted"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * The track's board: every player's best valid lap, in the same game, assists and weather.
 * With `grupo` it is that group's board; without it, the player picks everyone or one of their groups.
 */
export function Leaderboard({ trackId, grupo }: { trackId: number; grupo?: number }) {
  const [categoria, setCategoria] = useState<"sin_ayudas" | "con_ayudas">("sin_ayudas");
  const [clima, setClima] = useState<"seco" | "mojado">("seco");
  const [juego, setJuego] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const { data: groups } = useApi<{ grupos: GroupRow[] }>(grupo == null ? "/api/groups" : null);
  useEffect(() => {
    // A link from a group's page opens the circuit on that group's board.
    const fromUrl = Number(new URLSearchParams(window.location.search).get("grupo"));
    if (fromUrl) setPicked(fromUrl);
  }, []);
  const group = grupo ?? (groups?.grupos.some((g) => g.id === picked) ? picked : null);
  const q = `/api/leaderboard?track_id=${trackId}&categoria=${categoria}&clima=${clima}${juego ? `&juego=${juego}` : ""}${group ? `&grupo=${group}` : ""}`;
  const { data: b, loading } = useApi<Board>(q);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    // Open on a board that has laps: the default (no assists, dry) is often empty in a small group.
    if (touched || !b || b.filas.length > 0 || b.opciones.length === 0) return;
    const best = [...b.opciones].sort((x, y) => y.pilotos - x.pilotos)[0];
    setTouched(true);
    setCategoria(best.categoria as "sin_ayudas" | "con_ayudas");
    setClima(best.clima as "seco" | "mojado");
    setJuego(best.juego);
  }, [b, touched]);
  const games = [...new Map((b?.opciones ?? []).map((o) => [o.juego, o.juego_nombre])).entries()];
  const rows = b?.filas ?? [];
  const meOutside = b?.yo && !rows.some((r) => r.soy_yo) ? b.yo : null;

  const line = (r: Row) => (
    <tr key={r.pos} className={r.soy_yo ? "bg-accent/12" : ""}>
      <td className={`title num w-10 py-2.5 pl-3 text-[1.05rem] ${r.pos <= 3 ? "text-fg" : "text-dim"}`}>{r.pos}</td>
      <td className="py-2.5">
        <span className={`font-semibold ${r.soy_yo ? "text-accent-ink" : ""}`}>{r.nombre}</span>
        {r.soy_yo && <span className="ml-2 text-[0.75rem] text-accent-ink">vos</span>}
        {r.equipo && <span className="block text-[0.75rem] text-dim sm:hidden">{r.equipo}</span>}
      </td>
      <td className="hidden py-2.5 text-[0.85rem] text-dim sm:table-cell">{r.equipo ?? ""}</td>
      <td className={`num py-2.5 text-right font-mono text-[0.95rem] ${r.pos === 1 ? "text-best" : ""}`}>{lapS(r.tiempo_ms / 1000)}</td>
      <td className="num w-24 py-2.5 pr-3 text-right font-mono text-[0.85rem] text-dim">{gap(r.dif_ms)}</td>
    </tr>
  );

  return (
    <div className="card flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="eyebrow">{grupo != null ? "Clasificación del grupo" : "Clasificación"}</h2>
          <p className="mt-1 text-[0.82rem] text-muted">
            La mejor vuelta válida de cada piloto{b?.juego_nombre ? ` en ${b.juego_nombre}` : ""}{b?.pilotos ? ` · ${b.pilotos} ${b.pilotos === 1 ? "piloto" : "pilotos"}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {grupo == null && (groups?.grupos.length ?? 0) > 0 && (
            <select value={group ?? ""} onChange={(e) => setPicked(e.target.value ? Number(e.target.value) : null)} aria-label="Contra quién" className="h-[34px] rounded-[8px] border border-line bg-bg px-2 text-[0.82rem]">
              <option value="">Todos</option>
              {groups!.grupos.map((g) => (
                <option key={g.id} value={g.id}>{g.nombre}</option>
              ))}
            </select>
          )}
          <Toggle label="Ayudas" value={categoria} onChange={(v) => { setTouched(true); setCategoria(v); }} options={[["sin_ayudas", "Sin ayudas"], ["con_ayudas", "Con ayudas"]]} />
          <Toggle label="Clima" value={clima} onChange={(v) => { setTouched(true); setClima(v); }} options={[["seco", "Seco"], ["mojado", "Lluvia"]]} />
          {games.length > 1 && (
            <select value={juego ?? b?.juego ?? ""} onChange={(e) => { setTouched(true); setJuego(Number(e.target.value)); }} aria-label="Juego" className="h-[34px] rounded-[8px] border border-line bg-bg px-2 text-[0.82rem]">
              {games.map(([g, name]) => (
                <option key={g} value={g}>{name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      {rows.length === 0 && (loading || (!touched && (b?.opciones.length ?? 0) > 0)) ? (
        <LoadingScreen compact size={48} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-[0.92rem] text-muted">
          Todavía nadie marcó una vuelta válida acá {categoria === "sin_ayudas" ? "sin ayudas" : "con ayudas"} y {clima === "seco" ? "en seco" : "con lluvia"}. La tuya entra sola cuando corras.
        </p>
      ) : (
        <table className="w-full border-collapse">
          <tbody className="divide-y divide-line">
            {rows.map(line)}
            {meOutside && (
              <>
                <tr><td colSpan={5} className="py-1 text-center text-dim">···</td></tr>
                {line(meOutside)}
              </>
            )}
          </tbody>
        </table>
      )}
      <p className="text-[0.75rem] text-dim">
        Sin ayudas: sin control de tracción, sin ABS, caja manual y sin ayuda de frenado. Cuentan solo las vueltas que el juego da por válidas.
      </p>
    </div>
  );
}
