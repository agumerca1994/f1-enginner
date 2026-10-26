"use client";

import { useCallback, useEffect, useState } from "react";

import { OVERLAY_PANELS } from "@/components/overlay/Overlay";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type OverlayLink = { id: number; name: string; token_prefix: string; created_at: string; last_used_at: string | null };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", hour12: false }) : "nunca";

// Read-only links to single live panels, for OBS or a second screen. The token
// goes in the URL, so it is shown once, with every panel's address built from it.
export function OverlaySection() {
  const { credentials } = useAuth();
  const [links, setLinks] = useState<OverlayLink[] | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks(await api<OverlayLink[]>("/api/overlay/tokens", await credentials()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [credentials]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  const create = async () => {
    const name = prompt("¿Dónde lo vas a usar? (por ejemplo, OBS):", "OBS");
    if (!name?.trim()) return;
    try {
      const res = await api<{ token: string }>("/api/overlay/tokens", await credentials(), {
        method: "POST",
        body: { name: name.trim() },
      });
      setCreated(res.token);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el link");
    }
  };

  const revoke = async (l: OverlayLink) => {
    if (!confirm(`¿Revocar "${l.name}"? Los paneles que lo usan se apagan en menos de un minuto.`)) return;
    await api(`/api/overlay/tokens/${l.id}`, await credentials(), { method: "DELETE" });
    load();
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="label">Paneles flotantes</h2>
        <button onClick={create} className="text-sm text-accent underline">
          Crear link
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        Paneles sueltos con fondo transparente: delta, relativos, tiempos, posiciones, pedales y la radio del ingeniero.
        En OBS se agregan como “Navegador”. El link sólo deja mirar tu sesión en vivo.
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {created && (
        <div className="mt-3 rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm">
          <p>Copiá los que vayas a usar ahora: el link no se vuelve a mostrar.</p>
          <ul className="mt-2 space-y-2">
            {Object.entries(OVERLAY_PANELS).map(([key, p]) => {
              const url = `${origin}/overlay/${key}?t=${created}`;
              return (
                <li key={key} className="flex items-center gap-2">
                  <span className="w-36 shrink-0">
                    {p.label}
                    <span className="block text-xs text-muted">{p.size}</span>
                  </span>
                  <code className="num min-w-0 flex-1 truncate rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-xs">{url}</code>
                  <button onClick={() => copy(url)} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm">
                    {copied === url ? "Copiado" : "Copiar"}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Opciones al final del link: <code>&amp;escala=1.5</code> agranda, <code>&amp;opacidad=60</code> aclara el fondo,{" "}
            <code>&amp;filas=5</code> cambia cuántos autos se ven y en la radio <code>&amp;voz=1</code> la lee en voz alta.
          </p>
        </div>
      )}

      {links?.length === 0 && !created && <p className="mt-3 text-sm text-muted">No creaste ninguno todavía.</p>}
      <ul className="divide-y divide-line">
        {links?.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="truncate">
                {l.name} <span className="num text-xs text-muted">{l.token_prefix}…</span>
              </div>
              <div className="text-xs text-muted">Último uso {when(l.last_used_at)}</div>
            </div>
            <button onClick={() => revoke(l)} className="text-sm text-danger">
              Revocar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
