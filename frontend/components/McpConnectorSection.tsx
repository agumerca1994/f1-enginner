"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Connection = { grant_id: string; client_name: string; connected_at: string | null; last_used_at: string | null };
type Token = { id: number; name: string; token_prefix: string; expires_at: string | null; last_used_at: string | null };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", hour12: false }) : "nunca";

// Connect an AI app (Claude, etc.) to the player's telemetry over MCP: the
// connector URL for OAuth clients, the apps already connected, and personal
// tokens for clients that only take a header.
export function McpConnectorSection() {
  const { credentials } = useAuth();
  const [url, setUrl] = useState<string>("");
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const creds = await credentials();
      const [c, t] = await Promise.all([
        api<{ connections: Connection[]; connector_url: string }>("/oauth/connections", creds),
        api<{ tokens: Token[] }>("/oauth/tokens", creds),
      ]);
      setUrl(c.connector_url);
      setConnections(c.connections);
      setTokens(t.tokens);
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

  const disconnect = async (c: Connection) => {
    if (!confirm(`¿Desconectar "${c.client_name}"? Va a dejar de poder leer tus datos.`)) return;
    await api(`/oauth/connections/${encodeURIComponent(c.grant_id)}`, await credentials(), { method: "DELETE" });
    load();
  };

  const createToken = async () => {
    const name = prompt("Nombre del token (por ejemplo, Claude Code):");
    if (!name?.trim()) return;
    try {
      const res = await api<{ token: string }>("/oauth/tokens", await credentials(), {
        method: "POST",
        body: { name: name.trim(), expires_in_days: 90 },
      });
      setCreated(res.token);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el token");
    }
  };

  const revoke = async (t: Token) => {
    if (!confirm(`¿Revocar el token "${t.name}"?`)) return;
    await api(`/oauth/tokens/${t.id}`, await credentials(), { method: "DELETE" });
    load();
  };

  return (
    <section className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <h2 className="label">Conectar con una IA (MCP)</h2>
      <p className="mt-1 text-sm text-muted">
        Charlá con Claude u otra IA sobre tus carreras: en la app agregá un conector personalizado con esta URL y
        autorizalo con tu cuenta. Sólo puede leer.
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {url && (
        <div className="mt-3 flex items-center gap-2">
          <code className="num min-w-0 flex-1 truncate rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm">{url}</code>
          <button onClick={() => copy(url)} className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm hover:border-accent">
            {copied === url ? "Copiada" : "Copiar"}
          </button>
        </div>
      )}

      <h3 className="mt-5 text-sm font-medium">Apps conectadas</h3>
      {connections?.length === 0 && <p className="mt-1 text-sm text-muted">Ninguna todavía.</p>}
      <ul className="divide-y divide-line">
        {connections?.map((c) => (
          <li key={c.grant_id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="truncate">{c.client_name}</div>
              <div className="text-xs text-muted">Último uso {when(c.last_used_at)}</div>
            </div>
            <button onClick={() => disconnect(c)} className="text-sm text-danger">
              Desconectar
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center justify-between">
        <h3 className="text-sm font-medium">Tokens personales</h3>
        <button onClick={createToken} className="text-sm text-accent underline">
          Crear token
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">Para clientes que no usan OAuth: van en el header Authorization: Bearer.</p>
      {created && (
        <div className="mt-3 rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm">
          <p>Copialo ahora: no se vuelve a mostrar.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="num min-w-0 flex-1 truncate">{created}</code>
            <button onClick={() => copy(created)} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm">
              {copied === created ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      )}
      <ul className="divide-y divide-line">
        {tokens?.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="truncate">
                {t.name} <span className="num text-xs text-muted">{t.token_prefix}…</span>
              </div>
              <div className="text-xs text-muted">
                Último uso {when(t.last_used_at)}
                {t.expires_at && ` · vence ${new Date(t.expires_at).toLocaleDateString("es-AR")}`}
              </div>
            </div>
            <button onClick={() => revoke(t)} className="text-sm text-danger">
              Revocar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
