"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";

import { RequireAuth } from "@/components/RequireAuth";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/sessions";

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return (
    <RequireAuth>
      <Join code={decodeURIComponent(code)} />
    </RequireAuth>
  );
}

/** What a shared group link opens: the group's name, and one button to join. */
function Join({ code }: { code: string }) {
  const { credentials } = useAuth();
  const router = useRouter();
  const { data, error } = useApi<{ id: number; nombre: string; miembros: number; ya_estas: boolean }>(`/api/groups/code/${encodeURIComponent(code)}`);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const join = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: number }>("/api/groups/join", await credentials(), { method: "POST", body: { codigo: code } });
      router.replace(`/grupos/${r.id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center gap-4 px-6">
      {error ? (
        <>
          <h1 className="display text-[2.4rem] uppercase">Ese link no anda</h1>
          <p className="text-muted">El grupo ya no existe o el código cambió. Pedile a quien te lo pasó uno nuevo.</p>
          <Link href="/grupos" className="btn self-start px-4 py-2.5">Ver tus grupos</Link>
        </>
      ) : !data ? (
        <p className="text-muted">Buscando el grupo…</p>
      ) : (
        <>
          <span className="eyebrow">Te invitaron a un grupo</span>
          <h1 className="display text-[3rem] uppercase leading-[0.9]">{data.nombre}</h1>
          <p className="text-muted">
            {data.miembros} {data.miembros === 1 ? "piloto" : "pilotos"}. Al entrar, tus mejores vueltas aparecen en la clasificación del grupo y ves las de ellos.
          </p>
          {data.ya_estas ? (
            <Link href={`/grupos/${data.id}`} className="btn-primary self-start px-6 py-3">Ya estás adentro: abrir</Link>
          ) : (
            <button type="button" onClick={() => void join()} disabled={busy} className="btn-primary self-start px-6 py-3 disabled:opacity-50">
              {busy ? "Entrando…" : "Unirme al grupo"}
            </button>
          )}
          {failed && <p className="text-[0.9rem] text-danger">No se pudo entrar: el grupo puede estar lleno.</p>}
        </>
      )}
    </main>
  );
}
