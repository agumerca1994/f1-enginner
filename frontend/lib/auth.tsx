"use client";

import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { auth, googleProvider } from "@/lib/firebase";

// Local development only: act as this email without Google sign-in. Ignored in
// production builds, and the API accepts it only with AUTH_DEV_MODE=true.
export const DEV_USER = process.env.NODE_ENV === "production" ? "" : process.env.NEXT_PUBLIC_DEV_USER || "";

export type Credentials = { token?: string; devUser?: string };

type AuthState = {
  ready: boolean;
  email: string | null;
  name: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  credentials: () => Promise<Credentials | null>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(Boolean(DEV_USER));

  useEffect(() => {
    if (DEV_USER) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  const signIn = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
  }, []);

  const credentials = useCallback(async (): Promise<Credentials | null> => {
    if (DEV_USER) return { devUser: DEV_USER };
    if (!auth.currentUser) return null;
    return { token: await auth.currentUser.getIdToken() };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      email: DEV_USER || user?.email || null,
      name: DEV_USER ? "Dev" : user?.displayName || null,
      signIn,
      signOut,
      credentials,
    }),
    [ready, user, signIn, signOut, credentials],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
