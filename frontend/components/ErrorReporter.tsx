"use client";

import { useEffect } from "react";

import { useAuth } from "@/lib/auth";
import { reportClientError } from "@/lib/report";

/** Catches errors outside React (event handlers, promises) and reports them. */
export function ErrorReporter() {
  const { email } = useAuth();
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message, email);
    const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason, email);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [email]);
  return null;
}
