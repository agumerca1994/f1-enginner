"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/report";

/** Shown instead of a blank page when the dashboard crashes; the error goes to the logs. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 text-center">
      <h1 className="text-xl font-semibold">Algo falló en el dashboard</h1>
      <p className="mt-2 text-sm text-muted">
        Ya quedó registrado para revisarlo. Probá de nuevo; si se repite, recargá la página.
      </p>
      <p className="num mt-3 break-words text-xs text-muted">{error.message}</p>
      <button onClick={reset} className="mt-6 rounded-xl bg-fg px-4 py-3 font-semibold text-bg">
        Reintentar
      </button>
    </main>
  );
}
