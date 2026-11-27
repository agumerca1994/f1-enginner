"use client";

import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export type AccessRequest = {
  tipo: "jugador" | "local";
  juego: string | null;
  plataforma: string | null;
  local: string | null;
  ciudad: string | null;
  butacas: number | null;
  nota: string | null;
};
export type AccessStatus = {
  habilitado: boolean;
  solicitud: AccessRequest | null;
};

const GAMES = ["Edición 2024", "Edición 2025", "Assetto Corsa / ACC", "iRacing", "Otro"];
const PLATFORMS = ["PC", "PlayStation", "Xbox"];

const field =
  "w-full rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 py-2.5 text-[0.95rem] focus:border-accent focus:outline-none";

function Choice({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`rounded-full px-3 py-1.5 text-[0.85rem] ${value === o ? "bg-accent/15 ring-1 ring-accent" : "bg-panel-2 text-muted"}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/**
 * Early access: shown to a signed-in player who has not redeemed an invite code yet.
 * They type the code we mailed them, or ask for one (as a player or as a sim-racing venue).
 */
export function AccessGate({
  status,
  onChange,
}: {
  status: AccessStatus;
  onChange: (s: AccessStatus) => void;
}) {
  const { email, credentials, signOut } = useAuth();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const prev = status.solicitud;
  const [editing, setEditing] = useState(!prev);
  const [tipo, setTipo] = useState<"jugador" | "local">(
    prev?.tipo ?? "jugador",
  );
  const [juego, setJuego] = useState(prev?.juego ?? "Edición 2024");
  const [plataforma, setPlataforma] = useState(
    prev?.plataforma ?? "PlayStation",
  );
  const [local, setLocal] = useState(prev?.local ?? "");
  const [ciudad, setCiudad] = useState(prev?.ciudad ?? "");
  const [butacas, setButacas] = useState(
    prev?.butacas ? String(prev.butacas) : "",
  );
  const [nota, setNota] = useState(prev?.nota ?? "");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const redeem = async () => {
    setRedeeming(true);
    setCodeError(null);
    try {
      await api("/api/access/redeem", await credentials(), {
        method: "POST",
        body: { code },
      });
      onChange({ ...status, habilitado: true });
    } catch (e) {
      setCodeError(
        e instanceof ApiError && e.status === 400
          ? "Ese código no es válido o ya se usó."
          : "No pudimos validarlo. Probá de nuevo.",
      );
    } finally {
      setRedeeming(false);
    }
  };

  const send = async () => {
    setSending(true);
    setSendError(null);
    try {
      const body = {
        tipo,
        juego,
        plataforma,
        local: tipo === "local" ? local.trim() || null : null,
        ciudad: ciudad.trim() || null,
        butacas: tipo === "local" && butacas ? Number(butacas) : null,
        nota: nota.trim() || null,
      };
      const r = await api<AccessStatus>(
        "/api/access/request",
        await credentials(),
        { method: "POST", body },
      );
      onChange(r);
      setEditing(false);
    } catch {
      setSendError("No pudimos guardarlo. Probá de nuevo.");
    } finally {
      setSending(false);
    }
  };

  return (
    // Over the whole app, nav included: nothing behind it works until the code is in.
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-5 px-5 py-10">
        <div>
          <div className="eyebrow">Acceso anticipado</div>
          <h1 className="display mt-2 text-[2.6rem] uppercase">
            Estamos abriendo de a poco
          </h1>
          <p className="mt-3 text-muted">
            El ingeniero está en beta cerrada. Si te llegó un código, ponelo
            acá. Si no, pedí acceso y te escribimos a{" "}
            <span className="text-fg">{email}</span> cuando sea tu turno.
          </p>
        </div>

        <form
          className="paper flex flex-col gap-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void redeem();
          }}
        >
          <span className="title text-[1.1rem]">Tengo un código</span>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ING-XXXX-XXXX"
              autoCapitalize="characters"
              spellCheck={false}
              className="num min-w-0 flex-1 rounded-[var(--radius-control)] border border-[#c4c8ce] bg-white px-3 py-2.5 font-mono tracking-wider text-[#0b0c0e] focus:border-[#0b0c0e] focus:outline-none"
            />
            <button
              type="submit"
              disabled={redeeming || !code.trim()}
              className="btn-ink shrink-0 px-5 disabled:opacity-40"
            >
              {redeeming ? "…" : "Entrar"}
            </button>
          </div>
          {codeError && (
            <p className="text-[0.85rem] text-[#b3261e]">{codeError}</p>
          )}
        </form>

        <section className="card flex flex-col gap-4 p-5">
          <span className="title text-[1.1rem]">Pedir acceso</span>
          {!editing && prev ? (
            <>
              <p className="text-[0.95rem]">
                <span className="text-ok">Listo, te anotamos.</span>{" "}
                {prev.tipo === "local"
                  ? `${prev.local ?? "Tu local"}${prev.ciudad ? `, ${prev.ciudad}` : ""}${prev.butacas ? ` · ${prev.butacas} butacas` : ""}.`
                  : `${prev.juego ?? ""}${prev.plataforma ? ` en ${prev.plataforma}` : ""}.`}{" "}
                Te escribimos cuando sea tu turno.
              </p>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="btn self-start px-4 py-2 text-[0.9rem]"
              >
                Cambiar mis datos
              </button>
            </>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <div
                className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-panel-2 p-1"
                role="group"
                aria-label="Quién sos"
              >
                {(["jugador", "local"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tipo === t}
                    onClick={() => setTipo(t)}
                    className={`title rounded-[calc(var(--radius-control)-2px)] py-2 text-[0.9rem] ${tipo === t ? "bg-fg text-bg" : "text-muted"}`}
                  >
                    {t === "jugador" ? "Soy piloto" : "Tengo un local"}
                  </button>
                ))}
              </div>
              {tipo === "local" && (
                <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                  <input
                    value={local}
                    onChange={(e) => setLocal(e.target.value)}
                    placeholder="Nombre del local"
                    maxLength={120}
                    required
                    className={field}
                  />
                  <input
                    value={butacas}
                    onChange={(e) =>
                      setButacas(e.target.value.replace(/\D/g, ""))
                    }
                    placeholder="Butacas"
                    inputMode="numeric"
                    className={field}
                  />
                </div>
              )}
              <input
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
                placeholder="Ciudad"
                maxLength={80}
                className={field}
              />
              <div className="flex flex-col gap-2">
                <span className="eyebrow">
                  {tipo === "local" ? "Juego principal" : "Qué jugás"}
                </span>
                <Choice options={GAMES} value={juego} onChange={setJuego} />
              </div>
              <div className="flex flex-col gap-2">
                <span className="eyebrow">
                  {tipo === "local" ? "Simuladores con" : "En"}
                </span>
                <Choice
                  options={PLATFORMS}
                  value={plataforma}
                  onChange={setPlataforma}
                />
              </div>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Algo más que quieras contarnos (opcional)"
                maxLength={1000}
                rows={2}
                className={field}
              />
              <button
                type="submit"
                disabled={sending}
                className="btn-primary self-start px-6 py-3 disabled:opacity-40"
              >
                {sending ? "Enviando…" : "Pedir acceso"}
              </button>
              {sendError && (
                <p className="text-[0.85rem] text-danger">{sendError}</p>
              )}
            </form>
          )}
        </section>

        <button
          type="button"
          onClick={() => void signOut()}
          className="self-center text-[0.85rem] text-muted hover:text-fg"
        >
          Entrar con otra cuenta
        </button>
      </main>
    </div>
  );
}
