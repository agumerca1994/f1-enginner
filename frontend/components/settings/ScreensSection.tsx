"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { STATUS_FIELDS, useStatusBarPrefs } from "@/components/ui/StatusBar";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCockpits } from "@/lib/cockpit";

export type Screen = { id: number; name: string; role: string; config: { cockpit?: string }; last_used_at: string | null };

export const ROLES: { id: string; name: string; description: string }[] = [
  { id: "tabla", name: "Tabla de posiciones", description: "Grande, para leer a tres metros" },
  { id: "cockpit", name: "Cockpit", description: "Tus piezas: delta, gomas, rivales" },
  { id: "muro", name: "Muro de boxes", description: "La sesión entera, Boxes y Pista" },
  { id: "mapa", name: "Mapa", description: "El circuito con todos los autos" },
  { id: "radio", name: "Radio", description: "Solo el ingeniero, en grande" },
  { id: "panel", name: "Panel para transmitir", description: "Una pieza con fondo transparente" },
];

export const roleName = (id: string) => ROLES.find((r) => r.id === id)?.name ?? id;

/** The screens linked to the account (a TV, a tablet, another computer) and what each shows. */
export function ScreensSection() {
  const { credentials } = useAuth();
  const { cockpits } = useCockpits();
  const [screens, setScreens] = useState<Screen[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setScreens(await api<Screen[]>("/api/screens", await credentials()));
    } catch {
      setScreens([]);
    }
  }, [credentials]);
  useEffect(() => {
    load();
  }, [load]);

  const update = async (s: Screen, body: Partial<Screen>) => {
    await api(`/api/screens/${s.id}`, await credentials(), { method: "PATCH", body });
    load();
  };
  const remove = async (s: Screen) => {
    if (!confirm(`¿Quitar "${s.name}"? Esa pantalla deja de mostrar tus datos.`)) return;
    await api(`/api/overlay/tokens/${s.id}`, await credentials(), { method: "DELETE" });
    load();
  };

  return (
    <section id="pantallas" className="flex scroll-mt-24 flex-col gap-2">
      <h2 className="eyebrow">Tus pantallas</h2>
      <div className="card flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-panel-2 px-4 py-3">
          <span>
            <span className="block font-semibold">Este dispositivo</span>
            <span className="text-[0.82rem] text-dim">Con tu cuenta: muestra toda la app</span>
          </span>
          <Link href="/cockpit/editar" className="text-[0.88rem] text-accent-ink">Armar cockpit</Link>
        </div>
        {screens?.map((s) => (
          <div key={s.id} className="flex flex-col gap-2 border-b border-panel-2 px-4 py-3 last:border-0">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="text-[0.82rem] text-dim">
                  {roleName(s.role)}
                  {s.role === "cockpit" && s.config.cockpit ? ` · ${cockpits?.find((c) => c.id === s.config.cockpit)?.name ?? ""}` : ""}
                </span>
              </span>
              <button type="button" onClick={() => setEditing(editing === s.id ? null : s.id)} className="text-[0.88rem] text-accent-ink">
                {editing === s.id ? "Listo" : "Cambiar"}
              </button>
            </div>
            {editing === s.id && (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-[0.82rem] text-muted">
                  Qué muestra
                  <select value={s.role} onChange={(e) => update(s, { role: e.target.value })} className="h-10 rounded-[8px] border border-line bg-bg px-2 text-[0.92rem] text-fg">
                    {ROLES.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </label>
                {s.role === "cockpit" && cockpits && (
                  <label className="flex flex-col gap-1 text-[0.82rem] text-muted">
                    Cockpit
                    <select value={s.config.cockpit ?? cockpits[0].id} onChange={(e) => update(s, { config: { ...s.config, cockpit: e.target.value } })} className="h-10 rounded-[8px] border border-line bg-bg px-2 text-[0.92rem] text-fg">
                      {cockpits.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="button" onClick={() => remove(s)} className="self-start text-[0.85rem] text-accent-ink">Quitar esta pantalla</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <Link href="/vincular" className="rounded-[var(--radius-card)] border border-dashed border-dim px-4 py-3 text-center text-[0.95rem] hover:border-muted">
        + Sumar pantalla
      </Link>
      <p className="text-[0.82rem] text-dim">
        En la tele, la tablet o la otra compu abrí <b className="text-muted">la app en /pantalla</b>: te muestra un código. Escanealo con este celular o escribilo en Sumar pantalla.
      </p>
    </section>
  );
}

/** The thin diagnostics line, opt-in per device. */
export function StatusBarSection() {
  const { prefs, save } = useStatusBarPrefs();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="eyebrow">Barra de estado</h2>
      <div className="card flex flex-col gap-3 px-4 py-4">
        <label className="flex items-center justify-between gap-3 text-[0.95rem]">
          Mostrarla arriba
          <input type="checkbox" role="switch" checked={prefs.on} onChange={(e) => save({ ...prefs, on: e.target.checked })} className="h-6 w-11 accent-[var(--color-accent)]" />
        </label>
        <p className="text-[0.85rem] text-muted">No sirve para correr: sirve para ver de un vistazo si la telemetría llega bien.</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qué muestra">
          {STATUS_FIELDS.map((f) => {
            const on = prefs.fields.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => save({ ...prefs, fields: on ? prefs.fields.filter((x) => x !== f.id) : [...prefs.fields, f.id] })}
                className={`rounded-full px-3 py-1.5 text-[0.85rem] ${on ? "bg-accent/15 ring-1 ring-accent" : "bg-panel-2 text-muted"}`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
