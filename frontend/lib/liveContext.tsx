"use client";

import { createContext, useContext } from "react";

import { useEngineerAlwaysOn } from "@/components/live/LiveBlocks";
import { useLive } from "@/lib/live";
import { useEngineerVoice } from "@/lib/voice";

type Shared = ReturnType<typeof useLive> & {
  voice: ReturnType<typeof useEngineerVoice>;
  /** Turns the engineer on or off, remembering a pause for this session. */
  setEngineerActive: (active: boolean) => Promise<void>;
};

const LiveContext = createContext<Shared | null>(null);

/**
 * One live connection for the whole signed-in app: the session screen, the status
 * bar and the radio dock all read the same snapshot, and the engineer's voice keeps
 * talking whichever screen is open.
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const live = useLive();
  const setEngineerActive = useEngineerAlwaysOn(live.snapshot, live.engineer, live.toggleEngineer, live.engineerBusy);
  const voice = useEngineerVoice(live.engineer.messages);
  return <LiveContext.Provider value={{ ...live, voice, setEngineerActive }}>{children}</LiveContext.Provider>;
}

export function useSharedLive(): Shared {
  const v = useContext(LiveContext);
  if (!v) throw new Error("useSharedLive outside LiveProvider");
  return v;
}

/** The same, or null on screens outside the signed-in app (overlays, linked screens). */
export function useMaybeSharedLive(): Shared | null {
  return useContext(LiveContext);
}
