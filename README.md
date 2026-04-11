# On-Call Training Simulator

A browser-based incident simulation platform for training software engineers to handle production on-call situations involving AWS services.

The trainee works inside a realistic single-tab environment that mirrors every tool used during a real incident — email, chat, ticketing, operations dashboards, log streams, runbooks, and a CI/CD pipeline. A high-severity incident unfolds in real time, driven by LLM-powered stakeholders. The trainee must diagnose the root cause, communicate with simulated colleagues, apply remediations, and resolve the incident. A structured debrief is generated afterward.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Setup](#setup)
5. [Running the App](#running-the-app)
6. [Running Tests](#running-tests)
7. [Scenarios](#scenarios)
8. [Project Structure](#project-structure)
9. [Contributing](#contributing)

---

## Features

- **Realistic incident environment** — tabbed UI with Email, Chat, Ticketing, Ops Dashboard, Logs, Wiki, and CI/CD panels
- **LLM-powered stakeholders** — coworkers, DBAs, and managers respond dynamically via any OpenAI-compatible API
- **Config-driven scenarios** — new scenarios require only YAML and Markdown files; no code changes
- **Time-series metrics** — generated baselines with realistic noise, rhythm, and configurable incident overlays
- **Remediation controls** — rollback, service restart, scale-out, deploy, and feature flag actions with game-engine-modelled consequences
- **Speed multiplier** — run simulations at 1×, 2×, 5×, or 10× speed
- **Post-incident debrief** — LLM-generated narrative comparing trainee actions against the ideal response path
- **Mock LLM mode** — fully deterministic offline mode; no API key required

---

## Architecture

The entire simulation engine runs in the browser. There is no backend server.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser                                                                 │
│                                                                          │
│  ┌──────────────────────────────────────┐   ┌──────────────────────────┐│
│  │  Sim Shell                           │   │  Coach Panel (slide-out) ││
│  │  [ Email ][ Chat ][ Tickets ]        │   │  Proactive nudges        ││
│  │  [ Ops   ][ Logs ][ Wiki   ][ CI/CD ]│   │  + on-demand help        ││
│  │  Speed: [1×][2×][5×][10×]  [Pause]  │   └──────────────────────────┘│
│  └──────────────────────────────────────┘                               │
│                                                                          │
│  Game Engine (pure TypeScript, runs in-browser)                         │
│  ├── GameLoop — tick-driven sim clock, pause/resume, speed control      │
│  ├── EventScheduler — fires scripted scenario events at sim time        │
│  ├── StakeholderEngine — LLM-driven persona responses (chat + email)    │
│  ├── MetricReactionEngine — LLM-driven metric trajectory changes        │
│  ├── MetricStore — live time-series generation (baseline + overlay)     │
│  ├── SimStateStore — in-memory session state                            │
│  ├── AuditLog — records all trainee actions with sim timestamps         │
│  └── Evaluator — scores trainee against scenario's ideal response path  │
│                                                                          │
│  LLM Client                                                             │
│  ├── local mode  — calls VITE_LLM_BASE_URL directly from browser        │
│  ├── proxy mode  — calls /llm (forwarded to sidecar) — no key in browser│
│  └── mock mode   — reads bundled fixture YAML; no network calls         │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ (proxy mode only)
┌─────────────────────────────────▼────────────────────────────────────────┐
│  LLM Proxy Sidecar (Python / FastAPI + LiteLLM)                          │
│  Accepts OpenAI-compatible requests, forwards to any LLM provider.       │
│  LLM credentials live only here — never in the browser bundle.           │
│  Supports: OpenAI, Anthropic, AWS Bedrock, or any LiteLLM-compatible URL │
└──────────────────────────────────────────────────────────────────────────┘
```

### Deployment modes

| Mode      | How it works                                                                                         | When to use                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **local** | Browser calls an LLM endpoint directly (`VITE_LLM_BASE_URL`). Credentials are in the browser.        | Local dev with a personal API key                                        |
| **proxy** | Browser calls `/llm` (a local path), forwarded to a Python sidecar that holds the credentials.       | Production / shared deployments where you don't want keys in the browser |
| **mock**  | No network calls. Deterministic fixture responses from `scenarios/_fixture/mock-llm-responses.yaml`. | Tests and offline demos                                                  |

---

## Prerequisites

- Node.js 20 LTS
- npm 10+
- An LLM endpoint (OpenAI-compatible) — or use mock mode for offline/test runs

---

## Setup

```bash
git clone https://github.com/lenaxia/oncall-sim.git
cd oncall-sim
npm install
```

Then configure the client environment (see below).

---

## Running the App

### Local mode — browser calls LLM directly

Create `client/.env.local`:

```env
VITE_LLM_MODE=local
VITE_LLM_BASE_URL=https://api.openai.com/v1
VITE_LLM_API_KEY=sk-...
VITE_LLM_MODEL=gpt-4o
```

Then start the dev server:

```bash
npm run dev
```

Open http://localhost:3001.

### Proxy mode — credentials stay server-side

This mode runs a Python sidecar that holds LLM credentials. The browser never sees them.

**Local testing with Docker Compose:**

```bash
cp proxy/.env.example proxy/.env
# Edit proxy/.env with your LLM credentials (model, API key, base URL)
docker-compose up --build
```

Open http://localhost:3000.

**Kubernetes deployment:**

```bash
# Create the secret from the example
cp k8s/secret.yaml.example k8s/secret.yaml
# Edit k8s/secret.yaml with real credentials
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
```

The proxy sidecar accepts any LiteLLM-supported model string:

```env
# proxy/.env or k8s/secret.yaml
LLM_MODEL=openai/gpt-4o
LLM_API_KEY=sk-...
LLM_BASE_URL=                    # leave empty for provider default
```

```env
# Bedrock example (use IAM role — LLM_API_KEY not needed)
LLM_MODEL=bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0
LLM_API_KEY=
LLM_BASE_URL=
```

### Mock mode — no LLM required

```bash
VITE_MOCK_LLM=true npm run dev
```

Or set `VITE_MOCK_LLM=true` in `client/.env.local`. All LLM responses are read from the bundled fixture files — no network calls, fully deterministic.

### Production build

```bash
npm run build
```

Outputs a static bundle to `client/dist/`. Serve it with any static file server. `VITE_*` env vars are baked into the bundle at build time.

---

## Running Tests

All tests run in mock mode automatically — no LLM credentials needed.

```bash
# Run all tests
npm test

# With coverage
npm run test:coverage --workspace=client

# Type checking
npm run typecheck

# Lint
npm run lint

# Format
npm run format
```

There are 69 test files covering the game engine, metric system, scenario loader, all UI tabs, React contexts, LLM providers, and components.

---

## Scenarios

Scenarios live in the `scenarios/` directory. Each scenario is a self-contained folder:

```
scenarios/
└── my-scenario/
    ├── scenario.yaml              # Required: full scenario config
    └── mock-llm-responses.yaml   # Required: deterministic responses for tests
```

All content (emails, tickets, wiki runbooks, log patterns, metric overlays, stakeholder personas, remediation actions) is defined in `scenario.yaml`. No external files are required.

`scenario.yaml` defines:

- Incident metadata (title, difficulty, affected services, component topology)
- Metrics: baselines, noise profiles, and incident overlays
- Scripted log entries, repeating log patterns, and ambient background profiles
- Stakeholder personas and their communication triggers
- Remediation actions and the expected resolution path

Included scenarios:

| Scenario                     | Description                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `payment-db-pool-exhaustion` | Database connection pool misconfiguration causes payment service degradation |
| `cache-stampede`             | Cache expiry triggers thundering-herd load on the database                   |
| `fraud-api-quota-exhaustion` | Fraud detection API quota exhaustion degrades checkout                       |
| `lambda-cold-start-cascade`  | Lambda cold start cascade under traffic spike                                |
| `memory-leak-jvm`            | JVM memory leak causes gradual service degradation                           |
| `tls-cert-expiry`            | Expiring TLS certificate causes intermittent connection failures             |

See `README-LLM.md` for the complete scenario authoring reference.

---

## Project Structure

```
oncall-sim/
├── package.json              # npm workspace root (workspaces: ["client"])
├── docker-compose.yml        # Local proxy-mode testing (client + sidecar)
├── shared/
│   └── types/
│       └── events.ts         # Canonical TypeScript types
├── scenarios/                # Scenario YAML configs and fixture responses
├── client/                   # React SPA — the entire application
│   ├── src/
│   │   ├── engine/           # Game loop, scheduler, stakeholder engine, evaluator
│   │   ├── metrics/          # Time-series metric generator and store
│   │   ├── llm/              # LLM provider abstraction (OpenAI, Mock)
│   │   ├── scenario/         # YAML loader, Zod schema, component topology
│   │   ├── context/          # SessionContext, ScenarioContext
│   │   ├── components/       # UI components and tab panels
│   │   └── hooks/            # useSimClock
│   ├── __tests__/            # 69 test files (Vitest + React Testing Library)
│   ├── vite.config.ts
│   └── package.json
├── proxy/                    # Python / FastAPI + LiteLLM sidecar
│   ├── main.py
│   ├── Dockerfile
│   └── requirements.txt
└── k8s/                      # Kubernetes deployment manifests
    ├── deployment.yaml
    └── secret.yaml.example
```

---

## Contributing

See [`README-LLM.md`](README-LLM.md) for the full implementation guide, including:

- Hard rules (TDD, TypeScript strictness, mock mode requirements)
- Phase-by-phase development order
- Scenario authoring reference (YAML schema, log patterns, metric overlays)
