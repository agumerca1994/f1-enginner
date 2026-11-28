"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { LogoMark } from "@/components/brand/LogoMark";

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
  const [baseline, setBaseline] = useState<string>("");
  const [area, setArea] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const grid = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!cockpits || draft) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("nuevo")) {
      const t = TEMPLATES.find((x) => x.id === "monitor")!;
      setDraft({ ...structuredClone(t), id: `k${Date.now().toString(36)}`, name: "Cockpit nuevo", pieces: [] });
      setBaseline("nuevo");
      // a new cockpit asks for its name first
      setTimeout(() => nameInput.current?.select(), 50);
      return;
    }
    const found = structuredClone(cockpits.find((c) => c.id === q.get("id")) ?? cockpits[0]);
    setDraft(found);
    setBaseline(JSON.stringify(found));
  }, [cockpits, draft]);

  const ready = draft !== null;
  // The cockpit fills the space it has, whole, at its screen's shape: no page scroll.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setArea({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // Delete or Backspace removes the chosen piece (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!selected || t.closest("input, select, textarea")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove(selected);
      }
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
      const name = draft.name.trim() || "Mi cockpit";
      const next = { ...draft, name };
      await save(exists ? cockpits.map((c) => (c.id === draft.id ? next : c)) : [...cockpits, next]);
      setDraft(next);
      setBaseline(JSON.stringify(next));
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
    setBaseline("nuevo");
    setHistory([]);
    setTimeout(() => nameInput.current?.select(), 50);
  };

  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const leave = () => {
    if (dirty && !confirm("Tenés cambios sin guardar. ¿Salir igual y perderlos?")) return;
    router.push("/settings#pantallas");
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

  const frameW = area.w && area.h ? Math.min(area.w, area.h * aspect) : 0;
  const SELECT = "h-9 rounded-[8px] border border-line bg-panel px-2 text-[0.88rem] text-fg";

  return (
    <main className="flex min-h-dvh flex-col bg-bg pt-[env(safe-area-inset-top)] lg:h-dvh lg:overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-[max(1rem,env(safe-area-inset-left))] py-2.5 lg:px-5">
        <LogoMark size={30} target />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="eyebrow">Editor de cockpit</span>
          <label className="group flex min-w-0 items-center gap-2">
            <span className="sr-only">Nombre del cockpit</span>
            <input
              ref={nameInput}
              id="nombre-cockpit"
              value={draft.name}
              maxLength={40}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Ponele un nombre"
              size={Math.max(10, draft.name.length + 1)}
              className="title min-w-0 max-w-full rounded-[6px] border border-transparent bg-transparent px-1.5 py-0.5 text-[1.3rem] outline-none hover:border-line focus:border-accent"
            />
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-dim group-hover:text-muted" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
            </svg>
          </label>
        </div>
        <button type="button" onClick={undo} disabled={!history.length} className="btn hidden h-10 px-3 text-[0.9rem] disabled:opacity-40 sm:block">
          Deshacer
        </button>
        <button type="button" onClick={leave} className="btn h-10 px-4 text-[0.9rem]">
          Salir
        </button>
        <button type="button" onClick={persist} disabled={saving || !dirty} className={`${dirty ? "btn-primary" : "btn text-ok"} h-10 px-5 text-[0.95rem]`}>
          {saving ? "Guardando…" : dirty ? "Guardar" : "✓ Guardado"}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)_290px]">
        {/* the only list that scrolls */}
        <aside className="order-2 flex max-h-[45vh] min-h-0 flex-col border-line lg:order-1 lg:max-h-none lg:border-r" aria-label="Agregar pieza">
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <h2 className="eyebrow">Agregar pieza</h2>
            <label className="sr-only" htmlFor="buscar-pieza">Buscar pieza</label>
            <input id="buscar-pieza" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar: gomas, delta, mapa…" className="h-10 rounded-[8px] border border-line bg-panel px-3 text-[0.9rem]" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3">
            {catalog.map(({ g, items }) => (
              <div key={g} className="flex flex-col gap-1.5">
                <span className="text-[0.78rem] text-dim">{g}</span>
                {items.map((k) => {
                  const sp = PIECES[k];
                  return (
                    <button key={k} type="button" onClick={() => add(k)} className="flex items-center gap-2 rounded-[8px] border border-line bg-panel px-3 py-2 text-left hover:border-muted">
                      <span className="text-accent-ink" aria-hidden="true">+</span>
                      <span className="flex-1 text-[0.9rem] font-semibold">{sp.name}</span>
                      <span className="font-mono text-[0.7rem] text-muted">{sp.initial[0]}×{sp.initial[1]}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        <section className="order-1 flex min-h-0 flex-col gap-3 bg-[#101114] p-3 lg:order-2 lg:p-5" aria-label="Tu cockpit">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[0.82rem] text-muted">
            <label className="flex items-center gap-2">
              Pantalla
              <select
                value={SCREENS.find((x) => x.aspect === aspect)?.name ?? SCREENS[3].name}
                onChange={(e) => setDraft({ ...draft, aspect: SCREENS.find((x) => x.name === e.target.value)!.aspect })}
                className={SELECT}
              >
                {SCREENS.map((x) => (
                  <option key={x.name}>{x.name}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Cuadrícula
              <select
                value={`${draft.cols}x${draft.rows}`}
                onChange={(e) => {
                  const [cols, rows] = e.target.value.split("x").map(Number);
                  change({ ...draft, cols, rows, pieces: draft.pieces.map((p) => fit(p, cols, rows)) });
                }}
                className={SELECT}
              >
                {["4x7", "6x4", "8x4", "8x6", "10x5", "12x6", "16x8"].map((g) => (
                  <option key={g} value={g}>{g.replace("x", " × ")}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Plantilla
              <select
                value=""
                onChange={(e) => {
                  const t = TEMPLATES.find((x) => x.id === e.target.value);
                  if (t) change({ ...structuredClone(t), id: draft.id, name: draft.name });
                }}
                className={SELECT}
              >
                <option value="">Empezar de…</option>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={duplicate} className="btn h-9 px-3 text-[0.85rem]">Duplicar</button>
          </div>

          <div ref={stage} className="grid min-h-[260px] flex-1 place-items-center lg:min-h-0">
            <div className="rounded-[22px] border-[8px] border-panel-2 bg-bg p-2" style={frameW ? { width: frameW, height: frameW / aspect } : { width: "100%", aspectRatio: String(aspect) }}>
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
                            <button
                              type="button"
                              aria-label={`Quitar ${PIECES[p.kind].name}`}
                              title="Quitar (Supr)"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                remove(p.id);
                              }}
                              className="absolute top-1 left-1 z-10 grid h-7 w-7 place-items-center rounded-full bg-danger text-[0.95rem] font-bold leading-none text-white shadow"
                            >
                              ×
                            </button>
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
          <p className={`min-h-[1.2rem] text-center text-[0.85rem] ${note ? "text-warn" : "text-dim"}`} role="status">
            {note ?? "Tocá una pieza para elegirla, arrastrala para moverla y estirala desde los bordes."}
          </p>
        </section>

        <aside className="order-3 flex min-h-0 flex-col gap-4 overflow-y-auto border-line p-4 lg:border-l" aria-label="Pieza elegida">
          {piece ? (
            <PieceInspector piece={piece} onStep={step} onRemove={() => remove(piece.id)} />
          ) : (
            <div className="flex flex-col gap-2 text-[0.9rem] text-muted">
              <span className="eyebrow">Pieza elegida</span>
              <p>Ninguna. Elegí una en el cockpit para cambiarle el tamaño o quitarla, o sumá una desde la lista.</p>
              {draft.pieces.length === 0 && <p className="text-dim">Tu cockpit está vacío: empezá por una plantilla o agregá piezas.</p>}
            </div>
          )}
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
      <button type="button" onClick={onRemove} className="h-10 rounded-[8px] border border-danger/50 text-[0.9rem] text-accent-ink hover:bg-danger/10">
        Quitar pieza <span className="text-dim">(Supr)</span>
      </button>
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
    </>
  );
}
