# On-Call Training Simulator

A browser-based incident simulation platform for training software engineers to handle production on-call situations involving AWS services.

The trainee works inside a realistic single-tab environment that mirrors every tool used during a real incident — email, chat, ticketing, operations dashboards, log streams, runbooks, and a CI/CD pipeline. A high-severity incident unfolds in real time, driven by LLM-powered stakeholders. The trainee must diagnose the root cause, communicate with simulated colleagues, apply remediations, and resolve the incident. A structured debrief is generated afterward.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Setup](#setup)
5. [Configuration](#configuration)
6. [Running the App](#running-the-app)
7. [Running Tests](#running-tests)
8. [Scenarios](#scenarios)
9. [Project Structure](#project-structure)
10. [Contributing](#contributing)

---

## Features

- **Realistic incident environment** — tabbed UI with Email, Chat, Ticketing, Ops Dashboard, Logs, Wiki, and CI/CD panels
- **LLM-powered stakeholders** — coworkers, DBAs, and managers respond dynamically via OpenAI-compatible APIs or AWS Bedrock
- **Config-driven scenarios** — new scenarios require only YAML and Markdown files; no code changes
- **Time-series metrics** — generated baselines with realistic noise, rhythm, and configurable incident overlays
- **Remediation controls** — rollback, service restart, scale-out, deploy, and feature flag actions
- **Speed multiplier** — run simulations at 1×, 2×, 5×, or 10× speed
- **Post-incident debrief** — LLM-generated narrative comparing trainee actions against the ideal response path
- **Mock LLM mode** — fully deterministic test mode; no API key required

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│                                                                     │
│  ┌─────────────────────────────────────┐   ┌─────────────────────┐ │
│  │  Sim Shell                          │   │  Coach Panel        │ │
│  │  [ Email ][ Chat ][ Tickets ]       │   │  (slide-out)        │ │
│  │  [ Ops   ][ Logs ][ Wiki   ][ CICD ]│   │  Proactive nudges   │ │
│  │  Speed: [1x][2x][5x][10x]  [Pause] │   │  + on-demand help   │ │
│  └─────────────────────────────────────┘   └─────────────────────┘ │
│                        │  SSE + REST                               │
└────────────────────────┼────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│  Node.js / Express Server                                           │
│                                                                     │
│  REST API          SSE Stream         Game Engine                   │
│  /scenarios        /events            game-loop                     │
│  /sessions         (per session)      event-scheduler               │
│  /actions                             stakeholder-engine            │
│                                       audit-log + evaluator         │
│                                                                     │
│  LLM Client (OpenAI-compat | Bedrock | Mock)                        │
│  Metrics Generator (baseline + rhythm + noise + overlay)            │
│  Scenario Loader + Zod Validator                                     │
└─────────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│  File System                                                        │
│  scenarios/<id>/scenario.yaml                                       │
│  scenarios/<id>/mock-llm-responses.yaml                             │
│  scenarios/<id>/email/ tickets/ wiki/                               │
└─────────────────────────────────────────────────────────────────────┘
```

**Server** — Node.js 20 + Express + TypeScript. Hosts the game engine, metric generator, scenario loader, LLM client, and SSE broker.

**Client** — React 18 + TypeScript + Tailwind CSS + Vite. Single-page application; communicates with the server over REST and Server-Sent Events.

**Shared** — `shared/types/events.ts` is the single source of truth for all TypeScript types, imported by both server and client.

---

## Prerequisites

- Node.js 20 LTS
- npm 10+
- An LLM backend — one of:
  - AWS account with Bedrock access (Claude model enabled in your region)
  - OpenAI API key (or any OpenAI-compatible endpoint)
  - Neither — use `MOCK_LLM=true` for offline/test mode

---

## Setup

```bash
# Clone the repo
git clone https://github.com/lenaxia/oncall-sim.git
cd oncall-sim

# Install all workspace dependencies
npm install

# Copy the environment template
cp .env.example .env
```

Edit `.env` with your LLM credentials (see [Configuration](#configuration) below).

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in the values relevant to your chosen LLM provider.

### LLM Provider

| Variable       | Default   | Description           |
| -------------- | --------- | --------------------- |
| `LLM_PROVIDER` | `bedrock` | `openai` or `bedrock` |

### AWS Bedrock

| Variable           | Default                          | Description                                                 |
| ------------------ | -------------------------------- | ----------------------------------------------------------- |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` | Bedrock model ID                                            |
| `AWS_REGION`       | `us-west-2`                      | AWS region                                                  |
| `AWS_PROFILE`      | _(empty)_                        | Named AWS profile; uses default credential chain if omitted |

### OpenAI / OpenAI-compatible

| Variable          | Default                     | Description  |
| ----------------- | --------------------------- | ------------ |
| `OPENAI_API_KEY`  | —                           | API key      |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API base URL |
| `OPENAI_MODEL`    | `gpt-4o`                    | Model name   |

### Server

| Variable            | Default        | Description                          |
| ------------------- | -------------- | ------------------------------------ |
| `PORT`              | `3001`         | HTTP server port                     |
| `SCENARIOS_DIR`     | `../scenarios` | Path to the scenarios directory      |
| `SESSION_EXPIRY_MS` | `600000`       | Session TTL in milliseconds (10 min) |

### LLM Tuning

| Variable          | Default | Description                   |
| ----------------- | ------- | ----------------------------- |
| `LLM_TIMEOUT_MS`  | `30000` | Per-call LLM timeout          |
| `LLM_MAX_RETRIES` | `2`     | LLM retry attempts on failure |

### Mock Mode

Set `MOCK_LLM=true` to run entirely without a live LLM API. The server reads deterministic responses from `scenarios/_fixture/mock-llm-responses.yaml`. This is the default for all tests.

---

## Running the App

### Development (server + client, with hot reload)

```bash
npm run dev
```

- Client: http://localhost:3000
- Server API: http://localhost:3001

### Development (separate processes)

```bash
# Server only (tsx watch)
npm run dev --workspace=server

# Client only (Vite HMR)
npm run dev --workspace=client
```

### Production build

```bash
npm run build --workspace=server   # TypeScript → dist/
npm run build --workspace=client   # Vite bundle
```

---

## Running Tests

All server tests run with `MOCK_LLM=true` automatically — no LLM credentials needed.

```bash
# All tests (server + client)
npm test

# Server tests only
npm test --workspace=server

# Client tests only
npm test --workspace=client

# With coverage
npm run test:coverage --workspace=server
npm run test:coverage --workspace=client
```

### Type checking and linting

```bash
npm run typecheck   # both workspaces
npm run lint        # both workspaces
npm run format      # Prettier on all .ts/.tsx/.json/.yaml/.md
```

---

## Scenarios

Scenarios live in the `scenarios/` directory. Each scenario is a self-contained folder:

```
scenarios/
└── my-scenario/
    ├── scenario.yaml              # Required: full scenario config
    ├── mock-llm-responses.yaml   # Required: deterministic LLM responses for tests
    ├── email/                    # Optional: pre-authored email bodies (Markdown)
    ├── tickets/                  # Optional: pre-authored ticket descriptions
    └── wiki/                     # Optional: runbook pages (Markdown)
```

`scenario.yaml` defines:

- Incident metadata (title, difficulty, affected services)
- Metrics: baselines, noise profiles, incident overlays, and reactive overlays
- Scripted log entries, repeating log patterns, and ambient background log profiles
- Stakeholder personas and their communication triggers
- Remediation actions and the expected resolution path

The included `scenarios/payment-db-pool-exhaustion/` scenario is a full production-quality example: a database connection pool misconfiguration causes payment service degradation.

See `README-LLM.md` for the complete scenario authoring reference, including log pattern syntax and background profile configuration.

---

## Project Structure

```
oncall-sim/
├── package.json          # npm workspace root
├── .env.example          # Environment variable reference
├── shared/
│   └── types/
│       └── events.ts     # Single source of truth for all TypeScript types
├── scenarios/            # Scenario YAML configs and content
├── server/               # Node.js/Express backend
│   ├── src/
│   │   ├── engine/       # Game loop, event scheduler, stakeholder engine
│   │   ├── metrics/      # Time-series metric generator
│   │   ├── llm/          # LLM provider abstraction (OpenAI, Bedrock, Mock)
│   │   ├── routes/       # REST API handlers
│   │   ├── scenario/     # YAML loader + Zod schema validation
│   │   ├── session/      # Session store and model
│   │   └── sse/          # Server-Sent Events broker
│   └── __tests__/        # Server test suite
├── client/               # React frontend
│   ├── src/
│   │   ├── components/   # UI components and tab panels
│   │   ├── context/      # Session and scenario React contexts
│   │   └── hooks/        # useSSE, useSimClock
│   └── __tests__/        # Client test suite
└── docs/
    ├── design/
    │   ├── hld.md        # Authoritative high-level design
    │   └── lld/          # Low-level designs per phase
    ├── backlog/          # User stories per phase
    └── worklog/          # Session progress entries
```

---

## Contributing

See [`README-LLM.md`](README-LLM.md) for the full implementation guide, including:

- Hard rules (TDD, TypeScript strictness, mock mode requirements)
- Phase-by-phase development order
- Branch naming conventions and workflow
- Documentation and worklog standards
- Scenario authoring reference
