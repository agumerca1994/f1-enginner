"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, liveSocketUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { EngineerState, Snapshot } from "@/lib/types";

export type LiveStatus = "connecting" | "live" | "waiting" | "offline";

/**
 * Subscribes to the player's live snapshot. Reconnects with backoff and keeps
 * the last snapshot on screen while offline, so a hiccup never blanks the page.
 */
export function useLive() {
  const { credentials, email } = useAuth();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [engineer, setEngineer] = useState<EngineerState>({ active: false, provider: null, messages: [] });
  const [engineerBusy, setEngineerBusy] = useState(false);
  const retry = useRef(0);

  useEffect(() => {
    if (!email) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = async () => {
      const creds = await credentials();
      if (stopped || !creds) return;
      setStatus((s) => (s === "live" ? s : "connecting"));
      ws = new WebSocket(liveSocketUrl());
      ws.onopen = () => ws?.send(JSON.stringify({ type: "auth", token: creds.token, dev_user: creds.devUser }));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "ready") {
          retry.current = 0;
          setStatus("waiting");
        } else if (msg.type === "snapshot") {
          setSnapshot(msg.data);
          setReceivedAt(Date.now());
          setStatus("live");
        } else if (msg.type === "idle") {
          setStatus("waiting");
        } else if (msg.type === "engineer_state") {
          setEngineer((e) => ({
            active: msg.active,
            provider: msg.provider,
            messages: msg.messages ?? e.messages,
          }));
        } else if (msg.type === "engineer_message") {
          setEngineer((e) => ({ ...e, messages: [...e.messages, msg.message].slice(-40) }));
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setStatus("offline");
        const delay = Math.min(30_000, 1000 * 2 ** retry.current++);
        timer = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [email, credentials]);

  const toggleEngineer = useCallback(
    async (active: boolean) => {
      setEngineerBusy(true);
      try {
        const state = await api<EngineerState>("/api/engineer/live", await credentials(), { method: "POST", body: { active } });
        setEngineer(state);
      } finally {
        setEngineerBusy(false);
      }
    },
    [credentials],
  );

  return { status, snapshot, receivedAt, engineer, engineerBusy, toggleEngineer };
}
