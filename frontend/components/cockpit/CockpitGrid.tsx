"use client";

import { PieceBody, urgent, type PieceContext } from "@/components/cockpit/Pieces";
import type { Cockpit, Piece } from "@/lib/cockpit";

/** One piece in its cell range; its text sizes follow the piece through container units. */
export function PieceFrame({ piece, ctx, selected = false, children }: { piece: Piece; ctx: PieceContext; selected?: boolean; children?: React.ReactNode }) {
  const hot = urgent(piece.kind, ctx.s);
  const light = piece.kind === "radio";
  return (
    <div
      className={`relative min-h-0 min-w-0 overflow-hidden rounded-[var(--radius-card)] ${light ? "paper" : piece.kind === "luces" ? "" : "card"} ${hot ? "ring-2 ring-accent" : ""} ${selected ? "outline-2 outline-offset-2 outline-accent" : ""}`}
      style={{ gridColumn: `${piece.x + 1} / span ${piece.w}`, gridRow: `${piece.y + 1} / span ${piece.h}` }}
    >
      <div className={`h-full w-full ${piece.kind === "luces" ? "px-1" : "px-[clamp(8px,3.5cqw,18px)] py-[clamp(6px,5cqh,14px)]"}`} style={{ containerType: "size" }}>
        <PieceBody piece={piece} ctx={ctx} />
      </div>
      {children}
    </div>
  );
}

/** A cockpit drawn on its grid, filling the box it is given. */
export function CockpitGrid({ cockpit, ctx, className }: { cockpit: Cockpit; ctx: PieceContext; className?: string }) {
  return (
    <div
      className={`grid h-full w-full gap-[clamp(6px,0.7vw,10px)] ${className ?? ""}`}
      style={{ gridTemplateColumns: `repeat(${cockpit.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${cockpit.rows}, minmax(0, 1fr))` }}
    >
      {cockpit.pieces.map((p) => (
        <PieceFrame key={p.id} piece={p} ctx={ctx} />
      ))}
    </div>
  );
}
