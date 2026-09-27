"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function PairPage() {
  return (
    <RequireAuth>
      <Suspense>
        <PairForm />
      </Suspense>
    </RequireAuth>
  );
}

function PairForm() {
  const params = useSearchParams();
  const { credentials } = useAuth();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    try {
      const res = await api<{ name: string }>("/api/devices/pair/confirm", await credentials(), {
        method: "POST",
        body: { user_code: code },
      });
      setMessage(`Listo: "${res.name}" quedó vinculado a tu cuenta. En la computadora corré bridge run.`);
      setState("done");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo vincular");
      setState("error");
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Vincular el bridge</h1>
      <p className="mt-2 text-sm text-muted">
        Escribí el código que muestra <code className="num text-fg">bridge pair</code> en tu computadora.
      </p>
      {state === "done" ? (
        <>
          <p className="mt-6 rounded-xl border border-ok/40 bg-ok/10 p-4 text-sm">{message}</p>
          <Link href="/" className="mt-6 text-center text-accent underline">
            Ir al dashboard
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={9}
            className="num w-full rounded-xl border border-line bg-panel px-4 py-3 text-center text-2xl tracking-[0.3em] outline-none focus:border-accent"
          />
          <button
            disabled={code.replace("-", "").length !== 8 || state === "sending"}
            className="w-full rounded-xl bg-fg px-4 py-3 font-semibold text-bg disabled:opacity-40"
          >
            {state === "sending" ? "Vinculando…" : "Vincular"}
          </button>
          {state === "error" && <p className="text-sm text-danger">{message}</p>}
        </form>
      )}
    </main>
  );
}
