// server.js — minimal runtime server for the client SPA.
//
// Serves the Vite-built static files and injects runtime config
// directly into index.html as window.__CONFIG__ so the browser
// never needs a separate fetch.
//
// Proxy token protection
// ──────────────────────
// When PROXY_TOKEN_SECRET is set, each HTML response includes a short-lived
// signed token in window.__CONFIG__.proxyToken.  The client sends this as the
// X-Proxy-Token header on every LLM request; the proxy validates the HMAC
// signature and rejects requests that are missing or expired.
//
// Token format (pipe-delimited, then HMAC-SHA256 hex-signed):
//   <expiry_unix_seconds>|<random_nonce>
//
// The nonce prevents two page loads in the same second from sharing a token.
// TTL is controlled by PROXY_TOKEN_TTL_SECONDS (default 3600 = 1 hour).

import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";
import { createHmac, randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist");
const PORT = parseInt(process.env.PORT ?? "3000", 10);

const app = express();

// ── Proxy token config ────────────────────────────────────────────────────────

const PROXY_TOKEN_SECRET = process.env.PROXY_TOKEN_SECRET ?? "";
const PROXY_TOKEN_TTL_SECONDS = parseInt(
  process.env.PROXY_TOKEN_TTL_SECONDS ?? "3600",
  10,
);
const TOKEN_ENABLED = PROXY_TOKEN_SECRET.length > 0;

if (!TOKEN_ENABLED) {
  console.warn(
    "[server] PROXY_TOKEN_SECRET is not set — proxy token protection disabled.",
  );
}

/**
 * Generates a short-lived HMAC-signed proxy token.
 * Format sent to browser: "<payload>.<signature>"
 * Payload: "<expiry_unix>|<nonce>"
 */
function generateProxyToken() {
  if (!TOKEN_ENABLED) return null;
  const expiry = Math.floor(Date.now() / 1000) + PROXY_TOKEN_TTL_SECONDS;
  const nonce = randomBytes(8).toString("hex");
  const payload = `${expiry}|${nonce}`;
  const sig = createHmac("sha256", PROXY_TOKEN_SECRET)
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

// ── Static runtime config (fixed at startup) ──────────────────────────────────

const STATIC_CONFIG = {
  debug: process.env.DEBUG === "true",
};

// ── Static asset serving ──────────────────────────────────────────────────────

const indexTemplate = readFileSync(join(DIST, "index.html"), "utf-8");

// Serve static assets (everything except index.html) with long cache.
app.use(
  express.static(DIST, {
    maxAge: "1y",
    immutable: true,
    index: false, // we handle index.html ourselves
  }),
);

// ── SPA fallback — inject per-request config ──────────────────────────────────

app.use((_req, res) => {
  const config = {
    ...STATIC_CONFIG,
    // null when token protection is disabled — client skips the header
    proxyToken: generateProxyToken(),
  };

  // Inject runtime config AND freeze __ONCALL_CONFIG__ against runtime mutation.
  // Object.freeze prevents any other script on the same origin from overwriting
  // scenarioUrls after page load (L2).
  const configScript = [
    `<script>`,
    `window.__CONFIG__ = ${JSON.stringify(config)};`,
    // Seal __ONCALL_CONFIG__ if it was set server-side; otherwise set to a frozen empty object.
    // Scripts that want to read it must do so before any mutation attempt.
    `window.__ONCALL_CONFIG__ = Object.freeze(window.__ONCALL_CONFIG__ || {});`,
    `</script>`,
  ].join("\n");
  const html = indexTemplate.replace("</head>", `${configScript}</head>`);

  // ── Security headers (M1) ──────────────────────────────────────────────────
  // Cache-Control: no-cache on HTML so browsers always revalidate (picks up new token).
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "text/html");
  // Prevent the page being embedded in an iframe on other origins (clickjacking).
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Stop browsers from MIME-sniffing response content away from the declared type.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Don't send the full Referer to cross-origin destinations.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Basic XSS filter for legacy browsers (no-op in modern ones, harmless).
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // Permissions Policy: deny access to sensors/camera/mic the app doesn't need.
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.send(html);
});

app.listen(PORT, () => {
  console.log(
    `client serving on :${PORT}  debug=${STATIC_CONFIG.debug}  tokenProtection=${TOKEN_ENABLED}`,
  );
});
