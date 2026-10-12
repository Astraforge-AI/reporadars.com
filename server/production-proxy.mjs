import { isIP } from "node:net";

const unavailableHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function unavailable() {
  return new Response(JSON.stringify({ error: { code: "UNAVAILABLE" } }), {
    status: 503,
    headers: unavailableHeaders,
  });
}

function clientIP(request, socketIP) {
  if (socketIP !== "127.0.0.1") return null;
  const value = request.headers.get("x-reporadars-client-ip");
  return value && isIP(value) ? value : null;
}

export function withProductionProxy(service) {
  if (!service || typeof service.handle !== "function")
    throw new TypeError("service.handle is required");
  return {
    async handle(request, { ip } = {}) {
      const realIP = clientIP(request, ip);
      return realIP ? service.handle(request, { ip: realIP }) : unavailable();
    },
  };
}
