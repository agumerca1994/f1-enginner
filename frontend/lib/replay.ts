"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Snapshot } from "@/lib/types";

export type ReplayState = {
  status: "loading" | "ready" | "error";
  error: string | null;
  snapshot: Snapshot | null;
  t: number;
  duration: number;
  playing: boolean;
  speed: number;
};

export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8, 16] as const;

/** Plays back a recorded session through the server, which rebuilds the dashboard state at any point in time. */
export function useReplay(sessionId: number) {
  const { credentials, email } = useAuth();
  const ws = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ReplayState>({
    status: "loading",
    error: null,
    snapshot: null,
    t: 0,
    duration: 0,
    playing: false,
    speed: 1,
  });

  useEffect(() => {
    if (!email) return;
    let closedByUs = false;
    (async () => {
      const creds = await credentials();
      if (!creds) return;
      const socket = new WebSocket(API_URL.replace(/^http/, "ws") + "/replay/v1");
      ws.current = socket;
      socket.onopen = () =>
        socket.send(JSON.stringify({ type: "auth", token: creds.token, dev_user: creds.devUser, session_id: sessionId }));
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "ready") {
          setState((s) => ({ ...s, status: "ready", duration: msg.duration_s }));
        } else if (msg.type === "frame") {
          setState((s) => ({
            ...s,
            status: "ready",
            t: msg.t,
            duration: msg.duration_s,
            playing: msg.playing,
            speed: msg.speed,
            snapshot: msg.data ?? s.snapshot,
          }));
        }
      };
      socket.onclose = (ev) => {
        if (closedByUs) return;
        setState((s) => ({
          ...s,
          status: "error",
          playing: false,
          error:
            ev.code === 4404
              ? "Esta sesión no tiene grabación."
              : ev.reason === "session not found"
                ? "No encontramos esa sesión en tu cuenta."
                : "Se cortó la conexión con el servidor.",
        }));
      };
    })();
    return () => {
      closedByUs = true;
      ws.current?.close();
    };
  }, [email, credentials, sessionId]);

  const send = useCallback((msg: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  }, []);

  return {
    ...state,
    play: useCallback(() => send({ type: "play" }), [send]),
    pause: useCallback(() => send({ type: "pause" }), [send]),
    seek: useCallback((t: number) => send({ type: "seek", t }), [send]),
    setSpeed: useCallback((value: number) => send({ type: "speed", value }), [send]),
  };
}
