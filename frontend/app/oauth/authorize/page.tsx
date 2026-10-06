"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { RequireAuth } from "@/components/RequireAuth";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// The consent screen of the MCP connector. The player arrives here from the AI
// app's browser window, often signed out: RequireAuth signs in with a popup, so
// the ?txn= in the URL survives.

type TxnInfo = {
  txn: string;
  client_name: string;
  redirect_host: string;
  scopes: string[];
};

export default function AuthorizePage() {
  return (
    <RequireAuth>
      <Suspense>
        <Consent />
      </Suspense>
    </RequireAuth>
  );
}

function Consent() {
  const txn = useSearchParams().get("txn");
  const { email, credentials } = useAuth();
  const [info, setInfo] = useState<TxnInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!txn) {
      setLoadError("Falta el identificador de la solicitud.");
      return;
    }
    api<TxnInfo>(`/oauth/authorize/txn/${encodeURIComponent(txn)}`, null)
      .then(setInfo)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setLoadError("Esta solicitud no existe o ya fue usada.");
        else if (e instanceof ApiError && e.status === 410) setLoadError("La solicitud expiró. Volvé a conectar desde la app.");
        else setLoadError("No se pudo cargar la solicitud. Probá de nuevo.");
      });
  }, [txn]);

  const decide = async (action: "consent" | "deny") => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ redirect_uri: string }>(`/oauth/authorize/${action}`, await credentials(), {
        method: "POST",
        body: { txn },
      });
      window.location.replace(res.redirect_uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la solicitud");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      {loadError ? (
        <>
          <h1 className="text-2xl font-semibold">No se puede continuar</h1>
          <p className="mt-2 text-sm text-danger">{loadError}</p>
        </>
      ) : !info ? (
        <p className="text-center text-muted">Cargando…</p>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{info.client_name}</h1>
          <p className="mt-1 text-sm text-muted">quiere conectarse a tu ingeniero de carrera</p>

          <div className="mt-6 rounded-2xl border border-line bg-panel p-4 text-sm">
            <p>
              <strong>Va a poder leer</strong> tus sesiones grabadas, la carrera en vivo y lo que te dijo el
              ingeniero por radio.
            </p>
            <p className="mt-2 text-muted">No puede cambiar nada ni manejar tu bridge.</p>
          </div>

          <div className="mt-4 space-y-1 text-xs text-muted">
            <p>
              Conectado como <span className="text-fg">{email}</span>
            </p>
            <p>
              Te va a devolver a <span className="num text-fg">{info.redirect_host}</span>
            </p>
          </div>

          {error && <p className="mt-4 text-sm text-danger">{error}</p>}

          <div className="mt-6 flex gap-2">
            <button
              onClick={() => decide("consent")}
              disabled={busy}
              className="flex-1 rounded-xl bg-fg px-4 py-3 font-semibold text-bg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "…" : "Autorizar"}
            </button>
            <button
              onClick={() => decide("deny")}
              disabled={busy}
              className="flex-1 rounded-xl border border-line px-4 py-3 text-muted hover:text-fg disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
          <p className="mt-4 text-xs text-muted">Podés desconectarla cuando quieras desde Ajustes.</p>
        </>
      )}
    </main>
  );
}
