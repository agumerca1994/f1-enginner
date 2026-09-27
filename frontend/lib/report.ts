import { API_URL } from "@/lib/api";

const sent = new Set<string>();

/** Sends a browser error to the server logs once per message, so crashes on phones are visible. */
export function reportClientError(error: unknown, email?: string | null) {
  const err = error instanceof Error ? error : new Error(String(error));
  const key = err.message;
  if (sent.has(key) || sent.size > 20) return;
  sent.add(key);
  fetch(`${API_URL}/api/client-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: err.message.slice(0, 2000),
      stack: err.stack?.slice(0, 8000),
      url: typeof location !== "undefined" ? location.href.slice(0, 500) : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
      email: email ?? null,
    }),
    keepalive: true,
  }).catch(() => {});
}
