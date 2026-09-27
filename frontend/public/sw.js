// Minimal service worker: makes the dashboard installable. It caches nothing on
// purpose; live telemetry must always come from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
