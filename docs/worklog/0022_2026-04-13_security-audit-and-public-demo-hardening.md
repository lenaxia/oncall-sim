# 0022 — 2026-04-13 — Security Audit and Public Demo Hardening

## Session Overview

Full security audit and penetration test of the project, followed by remediation
of all selected findings. The goal was to make the app safe for public demo
deployment — where anyone on the internet can reach the front end — without
introducing authentication friction for end users.

---

## What Was Done

### 1. Security Audit

Performed a complete static-analysis security audit covering:

- Dependency review (npm, Python)
- Authentication and authorization
- Injection vulnerabilities (SQL, command, SSRF, XSS)
- Secrets and sensitive data handling
- Network/protocol handling
- Input validation and sanitization
- Cryptography usage
- Infrastructure configuration (Docker, k8s)

**Findings summary:**

| ID  | Severity | Title                                                             |
| --- | -------- | ----------------------------------------------------------------- |
| H1  | High     | Unbounded `retry-after` can freeze browser indefinitely           |
| H2  | High     | SSRF via unvalidated remote scenario URLs                         |
| H3  | High     | Unauthenticated proxy — anyone on the network can incur LLM costs |
| M1  | Medium   | No HTTP security headers on either server                         |
| M2  | Medium   | DOMPurify config permits `javascript:` hrefs                      |
| M3  | Medium   | Hardcoded fallback LLM endpoint leaks data if env var unset       |
| M4  | Medium   | Proxy has no request body size limit                              |
| M5  | Medium   | Proxy leaks internal error details in API responses               |
| M6  | Medium   | Outdated cryptographic Python dependencies                        |
| L1  | Low      | Debug panel exposes full LLM traffic to all page visitors         |
| L2  | Low      | `window.__ONCALL_CONFIG__` is globally writable                   |
| L3  | Low      | Docker Compose `network_mode: host` bypasses network isolation    |
| L4  | Low      | Proxy defaults to `CORS_ORIGINS=*` if env var unset               |
| L5  | Low      | `VITE_LLM_API_KEY` baked into bundle if set                       |

---

### 2. H3 + M4 + M5 — Proxy authentication, body limits, sanitised errors

Implemented HMAC-signed short-lived proxy token system to protect the LLM
proxy endpoint from direct bot/script abuse without requiring user login:

- **`client/server.js`**: generates a token per page load —
  `<expiry_unix>|<nonce>.<HMAC-SHA256>` — and injects it into
  `window.__CONFIG__.proxyToken`. TTL controlled by `PROXY_TOKEN_TTL_SECONDS`
  (default 3600s).
- **`client/src/llm/openai-provider.ts`**: reads `window.__CONFIG__.proxyToken`
  and sends it as `X-Proxy-Token` on every LLM request.
- **`proxy/main.py`**: validates signature (constant-time compare) and expiry
  before forwarding. Rejects with 401 if missing or invalid.
- Body size limit: rejects requests > `MAX_BODY_BYTES` (default 512 KB) with 413.
- Per-IP rate limiting via `slowapi`: `RATE_LIMIT_PER_MINUTE` (default 20/min).
- Internal exceptions logged server-side; only generic messages returned to caller.
- `proxy/requirements.txt`: added `slowapi`.
- `client/src/declarations.d.ts`: typed `proxyToken` field on `window.__CONFIG__`.

---

### 3. H1 — Cap `retry-after`

`client/src/llm/openai-provider.ts:65`: clamped `retry-after` header value to
60 seconds via `Math.min(..., 60)`. Prevents a malicious or misbehaving proxy
response from freezing the browser tab indefinitely.

---

### 4. H2 — Validate remote scenario URLs

`client/src/components/ScenarioPicker.tsx`: added `isSafeScenarioUrl()` function
that rejects any URL that:

- Is not `http:` or `https:` scheme
- Targets `localhost`, `127.0.0.1`, `[::1]`, or any RFC-1918 private range
  when the app is served over HTTPS (production)

Called before `loadRemoteScenario()` — unsafe URLs are skipped with a console
warning rather than silently fetched.

---

### 5. M1 — HTTP security headers

**`client/server.js`** (HTML responses):

- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 1; mode=block`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

**`proxy/main.py`** (`SecurityHeadersMiddleware` on all responses):

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`

---

### 6. M2 — Block `javascript:` hrefs in rendered Markdown

`client/src/components/MarkdownRenderer.tsx`:

- Refactored to a lazy-initialised singleton `getPurify()` that applies hooks once.
- Added `afterSanitizeAttributes` hook: strips any `href` not matching
  `^https?://` (blocks `javascript:`, `data:`, `vbscript:`, etc.).
- Same hook enforces `rel="noopener noreferrer"` on all `<a>` tags (reverse-tabnapping fix, L6).
- Added `rel` to `ALLOWED_ATTR`.

---

### 7. M3 — Remove hardcoded LLM endpoint fallback

`client/src/llm/llm-client.ts`: removed `?? "https://ai.thekao.cloud/v1"`.
`VITE_LLM_BASE_URL` is now required — throws a clear `Error` at LLM client
init time if unset, rather than silently routing all traffic to a third-party
endpoint.

---

### 8. M6 — Pin Python crypto dependencies

`proxy/requirements.txt`: pinned minimum versions with no known critical CVEs:

- `cryptography>=43.0.0`
- `pyOpenSSL>=24.0.0`
- `certifi>=2024.6.0`

---

### 9. L2 — Freeze `window.__ONCALL_CONFIG__`

`client/server.js`: the injected `<script>` now includes
`window.__ONCALL_CONFIG__ = Object.freeze(window.__ONCALL_CONFIG__ || {})`.
Prevents any script running in the same origin from overwriting `scenarioUrls`
after page load.

---

### 10. L3 — Fix Docker Compose `network_mode: host`

`docker-compose.yml`: replaced `network_mode: host` on both services with a
`sim-net` bridge network. The proxy port is no longer exposed to the host by
default — client container reaches it by service name (`http://proxy:8000/llm`)
over the bridge. Eliminates the host-firewall bypass risk.

---

### 11. L4 — Fail-closed CORS

`proxy/main.py`: `CORS_ORIGINS` is now required. The proxy raises `RuntimeError`
at startup if the env var is unset, rather than defaulting to `*`. The parsed
list is used directly in the `CORSMiddleware` config.

---

### 12. L5 — Build-time API key guard

`client/Dockerfile`: added a `RUN` step after the `ARG` declarations that
checks `VITE_LLM_API_KEY` and fails the build with a clear error message if
it is non-empty. Prevents accidentally baking credentials into the public JS
bundle.

---

### 13. Infrastructure — k8s wiring

`k8s/deployment.yaml`: `PROXY_TOKEN_SECRET` wired into both containers from
`oncall-secrets` Kubernetes secret, so server.js and the proxy share the same
signing key.

`k8s/secret.yaml.example`: added `proxy-token-secret` field.

`proxy/.env.example` and `proxy/.env`: documented new env vars
(`PROXY_TOKEN_SECRET`, `PROXY_TOKEN_TTL_SECONDS`, `RATE_LIMIT_PER_MINUTE`).

---

### 14. k8s secret manifest in `talos-ops-prod`

Created the oncall-sim secret scaffold in the home cluster's GitOps repo,
following the existing SOPS+age convention used by other apps (e.g. tinyrsvp):

```
talos-ops-prod/kubernetes/apps/default/oncall-sim/
├── ks.yaml                    # Flux Kustomization
└── app/
    ├── kustomization.yaml
    └── secret.sops.yaml       # Template — fill REPLACE_ME values + sops encrypt
```

**Not yet committed** — requires filling in real values and encrypting with
`sops --encrypt` before the file is safe to commit.

---

## Files Changed

| File                                         | Change                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `client/Dockerfile`                          | Build guard: fail if `VITE_LLM_API_KEY` non-empty                                                 |
| `client/server.js`                           | HMAC token generation, `Object.freeze(__ONCALL_CONFIG__)`, security headers                       |
| `client/src/components/MarkdownRenderer.tsx` | DOMPurify hook: block non-https hrefs, enforce `rel=noopener noreferrer`                          |
| `client/src/components/ScenarioPicker.tsx`   | `isSafeScenarioUrl()` validation before remote fetch                                              |
| `client/src/declarations.d.ts`               | `proxyToken` field typed on `window.__CONFIG__`                                                   |
| `client/src/llm/llm-client.ts`               | Remove hardcoded fallback URL, require `VITE_LLM_BASE_URL`                                        |
| `client/src/llm/openai-provider.ts`          | Send `X-Proxy-Token` header; cap `retry-after` at 60s                                             |
| `docker-compose.yml`                         | Bridge network replacing `network_mode: host`                                                     |
| `k8s/deployment.yaml`                        | Wire `PROXY_TOKEN_SECRET` into both containers                                                    |
| `k8s/secret.yaml.example`                    | Add `proxy-token-secret` field                                                                    |
| `proxy/.env.example`                         | Document new env vars                                                                             |
| `proxy/main.py`                              | Token validation, rate limiting, body limit, sanitised errors, security headers, fail-closed CORS |
| `proxy/requirements.txt`                     | Add `slowapi`; pin `cryptography`, `pyOpenSSL`, `certifi`                                         |

---

## Findings Not Fixed

| ID  | Reason                                                                                |
| --- | ------------------------------------------------------------------------------------- |
| L1  | Debug panel only active when `DEBUG=true` is explicitly set; acceptable risk for demo |

---

## Commit

`7da8136` — `security: harden proxy and client for public demo deployment`

---

## What Comes Next

1. Fill in `REPLACE_ME` values in `talos-ops-prod/kubernetes/apps/default/oncall-sim/app/secret.sops.yaml`, encrypt with `sops`, and register in `kubernetes/apps/default/kustomization.yaml`
2. Rebuild Docker images to pick up `requirements.txt` and `Dockerfile` changes
3. Consider reducing `PROXY_TOKEN_TTL_SECONDS` from 3600s if 1-hour replay window is too wide for the threat model
4. Revisit L1 (debug panel access control) if `DEBUG=true` is ever needed in a shared deployment
