"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { PieceFrame } from "@/components/cockpit/CockpitGrid";
import { fit, freeSpot, overlaps, pieceId, PIECES, SCREENS, sizeLevel, TEMPLATES, useCockpits, type Cockpit, type Piece, type PieceKind } from "@/lib/cockpit";
import { useSharedLive } from "@/lib/liveContext";

const SHAPE_ES = { libre: "libre", apaisada: "siempre apaisada", vertical: "siempre vertical", fina: "una fila de alto" };
const GROUPS = ["Manejo", "Tiempos", "Rivales", "Pista", "Auto", "Ingeniero"] as const;

type Drag = { id: string; mode: "move" | "w" | "h" | "wh"; startX: number; startY: number; orig: Piece; cellW: number; cellH: number };

/**
 * Building a cockpit: a grid of cells where pieces go. Each piece starts at a
 * suggested size and stretches by whole cells, never below its minimum or out of
 * its shape, and shows more as it grows. It saves to the account, so every
 * screen of the player can use it.
 */
export function Editor() {
  const { snapshot: s, engineer } = useSharedLive();
  const { cockpits, save } = useCockpits();
  const [draft, setDraft] = useState<Cockpit | null>(null);
  const [history, setHistory] = useState<Cockpit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Piece | null>(null);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cockpits || draft) return;
    const id = new URLSearchParams(window.location.search).get("id");
    setDraft(structuredClone(cockpits.find((c) => c.id === id) ?? cockpits[0]));
  }, [cockpits, draft]);

  const change = (next: Cockpit) => {
    if (draft) setHistory((h) => [...h.slice(-30), draft]);
    setDraft(next);
    setNote(null);
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (prev) {
      setDraft(prev);
      setHistory((h) => h.slice(0, -1));
    }
  };

  const piece = draft?.pieces.find((p) => p.id === selected) ?? null;

  const place = (p: Piece): boolean => {
    if (!draft) return false;
    const fitted = fit(p, draft.cols, draft.rows);
    if (draft.pieces.some((o) => overlaps(fitted, o))) {
      setNote("Ahí ya hay otra pieza. Movela o achicala primero.");
      return false;
    }
    change({ ...draft, pieces: draft.pieces.map((o) => (o.id === p.id ? fitted : o)) });
    return true;
  };

  const add = (kind: PieceKind) => {
    if (!draft) return;
    const spec = PIECES[kind];
    const sizes: [number, number][] = [spec.initial, spec.min];
    for (const [w, h] of sizes) {
      const spot = freeSpot(draft, Math.min(w, draft.cols), Math.min(h, draft.rows));
      if (spot) {
        const p = fit({ id: pieceId(), kind, x: spot.x, y: spot.y, w, h }, draft.cols, draft.rows);
        change({ ...draft, pieces: [...draft.pieces, p] });
        setSelected(p.id);
        return;
      }
    }
    setNote(`No queda lugar para ${spec.name.toLowerCase()}. Achicá o quitá otra pieza.`);
  };

  const remove = (id: string) => {
    if (!draft) return;
    change({ ...draft, pieces: draft.pieces.filter((p) => p.id !== id) });
    setSelected(null);
  };

  const begin = (e: React.PointerEvent, p: Piece, mode: Drag["mode"]) => {
    if (!grid.current || !draft) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const r = grid.current.getBoundingClientRect();
    setSelected(p.id);
    setDrag({ id: p.id, mode, startX: e.clientX, startY: e.clientY, orig: p, cellW: r.width / draft.cols, cellH: r.height / draft.rows });
    setPreview(p);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag || !draft) return;
    const dx = Math.round((e.clientX - drag.startX) / drag.cellW);
    const dy = Math.round((e.clientY - drag.startY) / drag.cellH);
    const o = drag.orig;
    const next =
      drag.mode === "move"
        ? { ...o, x: o.x + dx, y: o.y + dy }
        : { ...o, w: drag.mode === "h" ? o.w : o.w + dx, h: drag.mode === "w" ? o.h : o.h + dy };
    setPreview(fit(next, draft.cols, draft.rows));
  };
  const end = () => {
    if (drag && preview && (preview.x !== drag.orig.x || preview.y !== drag.orig.y || preview.w !== drag.orig.w || preview.h !== drag.orig.h)) place(preview);
    setDrag(null);
    setPreview(null);
  };

  const step = (dw: number, dh: number) => piece && place({ ...piece, w: piece.w + dw, h: piece.h + dh });

  const persist = async () => {
    if (!draft || !cockpits) return;
    setSaving(true);
    try {
      const exists = cockpits.some((c) => c.id === draft.id);
      await save(exists ? cockpits.map((c) => (c.id === draft.id ? draft : c)) : [...cockpits, draft]);
      setHistory([]);
      setNote("Guardado. Ya lo ven todas tus pantallas.");
    } catch {
      setNote("No se pudo guardar. Revisá la conexión y probá de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const duplicate = () => {
    if (!draft) return;
    setDraft({ ...structuredClone(draft), id: `k${Date.now().toString(36)}`, name: `${draft.name} (copia)` });
    setHistory([]);
  };

  const catalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUPS.map((g) => ({
      g,
      items: (Object.keys(PIECES) as PieceKind[]).filter((k) => PIECES[k].group === g && (!q || PIECES[k].name.toLowerCase().includes(q) || PIECES[k].description.toLowerCase().includes(q))),
    })).filter((x) => x.items.length);
  }, [query]);

  if (!draft) return <main className="h-dvh" />;
  const aspect = draft.aspect ?? 1.78;
  const shown = draft.pieces.map((p) => (preview && p.id === preview.id ? preview : p));
  const blocked = !!preview && draft.pieces.some((o) => overlaps(preview, o));

  return (
    <main className="flex min-h-dvh flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-[max(1rem,env(safe-area-inset-left))] py-3 lg:px-6">
        <Link href="/cockpit" className="text-[0.9rem] text-muted">
          ‹ Listo
        </Link>
        <div className="min-w-0">
          <label className="sr-only" htmlFor="nombre-cockpit">Nombre del cockpit</label>
          <input
            id="nombre-cockpit"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="title w-[min(60vw,22rem)] bg-transparent text-[1.4rem] outline-none focus:border-b focus:border-line"
          />
          <div className="text-[0.78rem] text-dim">Cockpit · cuadrícula de {draft.cols} × {draft.rows} · se guarda en tu cuenta</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[0.82rem] text-muted">
            Pantalla
            <select
              value={SCREENS.find((x) => x.aspect === aspect)?.name ?? SCREENS[3].name}
              onChange={(e) => setDraft({ ...draft, aspect: SCREENS.find((x) => x.name === e.target.value)!.aspect })}
              className="h-9 rounded-[8px] border border-line bg-panel px-2 text-[0.88rem] text-fg"
            >
              {SCREENS.map((x) => (
                <option key={x.name}>{x.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[0.82rem] text-muted">
            Plantilla
            <select
              value=""
              onChange={(e) => {
                const t = TEMPLATES.find((x) => x.id === e.target.value);
                if (t) change({ ...structuredClone(t), id: draft.id, name: draft.name });
              }}
              className="h-9 rounded-[8px] border border-line bg-panel px-2 text-[0.88rem] text-fg"
            >
              <option value="">Empezar de…</option>
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={duplicate} className="btn h-9 px-3 text-[0.88rem]">Duplicar</button>
          <button type="button" onClick={undo} disabled={!history.length} className="btn h-9 px-3 text-[0.88rem] disabled:opacity-40">Deshacer</button>
          <button type="button" onClick={persist} disabled={saving} className="btn-primary h-9 px-4 text-[0.95rem]">{saving ? "Guardando…" : "Guardar"}</button>
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[270px_minmax(0,1fr)_300px]">
        <aside className="order-2 flex flex-col gap-3 border-line p-4 lg:order-1 lg:border-r" aria-label="Agregar pieza">
          <h2 className="eyebrow">Agregar pieza</h2>
          <label className="sr-only" htmlFor="buscar-pieza">Buscar pieza</label>
          <input id="buscar-pieza" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar: gomas, delta, mapa…" className="h-10 rounded-[8px] border border-line bg-panel px-3 text-[0.9rem]" />
          {catalog.map(({ g, items }) => (
            <div key={g} className="flex flex-col gap-1.5">
              <span className="mt-1 text-[0.78rem] text-dim">{g}</span>
              {items.map((k) => {
                const sp = PIECES[k];
                return (
                  <button key={k} type="button" onClick={() => add(k)} className="flex items-center gap-2 rounded-[8px] border border-line bg-panel px-3 py-2 text-left hover:border-muted">
                    <span className="flex-1 text-[0.9rem] font-semibold">{sp.name}</span>
                    <span className="font-mono text-[0.7rem] text-muted">{sp.initial[0]}×{sp.initial[1]}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <section className="order-1 flex flex-col items-center gap-3 bg-[#101114] p-4 lg:order-2 lg:p-8" aria-label="Tu cockpit">
          <p className="text-center text-[0.85rem] text-muted">Tocá una pieza para elegirla, arrastrala para moverla y estirala desde los bordes. Ocupa cuadros enteros.</p>
          <div className="w-full max-w-[920px]" style={{ maxWidth: aspect < 1 ? 380 : undefined }}>
            <div className="w-full rounded-[22px] border-[8px] border-panel-2 bg-bg p-2" style={{ aspectRatio: String(aspect) }}>
              <div ref={grid} className="relative h-full w-full touch-none" onPointerMove={move} onPointerUp={end} onPointerCancel={end} onClick={() => setSelected(null)}>
                <div className="absolute inset-0 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${draft.cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${draft.rows}, minmax(0,1fr))` }} aria-hidden="true">
                  {Array.from({ length: draft.cols * draft.rows }, (_, i) => (
                    <span key={i} className="rounded-[6px] border border-dashed border-line" />
                  ))}
                </div>
                <div className="absolute inset-0 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${draft.cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${draft.rows}, minmax(0,1fr))` }}>
                  {shown.map((p) => {
                    const sel = p.id === selected;
                    return (
                      <PieceFrame key={p.id} piece={p} ctx={{ s, messages: engineer.messages }} selected={sel}>
                        <button
                          type="button"
                          aria-label={`${PIECES[p.kind].name}, ${p.w} por ${p.h}`}
                          className={`absolute inset-0 cursor-grab ${sel && blocked ? "bg-danger/25" : sel ? "bg-accent/10" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(p.id);
                          }}
                          onPointerDown={(e) => begin(e, p, "move")}
                        />
                        <span className="pointer-events-none absolute top-1 right-1.5 rounded bg-bg/80 px-1 font-mono text-[0.62rem] text-muted">{p.w}×{p.h}</span>
                        {sel && (
                          <>
                            <span onPointerDown={(e) => begin(e, p, "w")} className="absolute top-1/2 right-0 h-10 w-3 -translate-y-1/2 cursor-ew-resize rounded-full bg-accent" />
                            <span onPointerDown={(e) => begin(e, p, "h")} className="absolute bottom-0 left-1/2 h-3 w-10 -translate-x-1/2 cursor-ns-resize rounded-full bg-accent" />
                            <span onPointerDown={(e) => begin(e, p, "wh")} className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize rounded-[4px] bg-accent" />
                          </>
                        )}
                      </PieceFrame>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          {note && <p className="text-[0.88rem] text-warn" role="status">{note}</p>}
          <label className="flex items-center gap-2 text-[0.82rem] text-muted">
            Cuadrícula
            <select
              value={`${draft.cols}x${draft.rows}`}
              onChange={(e) => {
                const [cols, rows] = e.target.value.split("x").map(Number);
                change({ ...draft, cols, rows, pieces: draft.pieces.map((p) => fit(p, cols, rows)) });
              }}
              className="h-9 rounded-[8px] border border-line bg-panel px-2 text-[0.88rem] text-fg"
            >
              {["4x7", "6x4", "8x4", "8x6", "10x5", "12x6", "16x8"].map((g) => (
                <option key={g} value={g}>{g.replace("x", " × ")}</option>
              ))}
            </select>
          </label>
        </section>

        <aside className="order-3 flex flex-col gap-4 border-line p-4 lg:border-l" aria-label="Pieza elegida">
          {piece ? <PieceInspector piece={piece} onStep={step} onRemove={() => remove(piece.id)} /> : <p className="text-[0.9rem] text-muted">Elegí una pieza para cambiarle el tamaño, o agregá una desde la lista.</p>}
        </aside>
      </div>
    </main>
  );
}

function Stepper({ label, value, onLess, onMore }: { label: string; value: number; onLess: () => void; onMore: () => void }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-[0.78rem] text-dim">{label}</div>
      <div className="mt-1 flex items-center justify-between">
        <button type="button" aria-label={`Menos ${label.toLowerCase()}`} onClick={onLess} className="btn h-8 w-8">−</button>
        <span className="display text-[1.6rem] not-italic">{value}</span>
        <button type="button" aria-label={`Más ${label.toLowerCase()}`} onClick={onMore} className="btn h-8 w-8">+</button>
      </div>
    </div>
  );
}

function PieceInspector({ piece, onStep, onRemove }: { piece: Piece; onStep: (dw: number, dh: number) => void; onRemove: () => void }) {
  const spec = PIECES[piece.kind];
  const level = sizeLevel(piece);
  return (
    <>
      <div>
        <span className="eyebrow">Pieza elegida</span>
        <h2 className="title mt-1 text-[1.8rem]">{spec.name}</h2>
        <p className="text-[0.88rem] text-muted">{spec.description}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stepper label="Ancho" value={piece.w} onLess={() => onStep(-1, 0)} onMore={() => onStep(1, 0)} />
        <Stepper label="Alto" value={piece.h} onLess={() => onStep(0, -1)} onMore={() => onStep(0, 1)} />
      </div>
      <dl className="flex flex-col gap-1.5 text-[0.9rem]">
        <div className="flex justify-between"><dt className="text-muted">Tamaño mínimo</dt><dd>{spec.min[0]}×{spec.min[1]}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Forma</dt><dd>{SHAPE_ES[spec.shape]}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Tamaño inicial</dt><dd>{spec.initial[0]}×{spec.initial[1]}</dd></div>
      </dl>
      <div>
        <h3 className="eyebrow mb-2">A este tamaño muestra</h3>
        <ul className="flex flex-col gap-1.5 text-[0.9rem]">
          {spec.sizes.map((x, i) => (
            <li key={i} className={i <= level ? "" : "text-dim"}>
              {i <= level ? "✓ " : "· "}
              {x.shows}
              {i > level && `, desde ${x.at[0]}×${x.at[1]}${x.or ? ` o ${x.or[0]}×${x.or[1]}` : ""}`}
            </li>
          ))}
        </ul>
      </div>
      <button type="button" onClick={onRemove} className="mt-auto h-10 rounded-[8px] border border-danger/40 text-[0.9rem] text-accent-ink">
        Quitar pieza
      </button>
    </>
  );
}
