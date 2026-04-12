FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace root + shared types
COPY package.json package-lock.json ./
COPY shared/ ./shared/

# Copy client package
COPY client/package.json ./client/

# Install deps (client workspace only)
RUN npm install --workspace=client

# Copy client source
COPY client/ ./client/
COPY scenarios/ ./scenarios/

# Build with k8s mode vars baked in
ARG VITE_LLM_MODE=proxy
ARG VITE_LLM_BASE_URL=/llm
ARG VITE_LLM_API_KEY=
ARG VITE_LLM_MODEL=

RUN npm run build --workspace=client

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Copy built assets and the runtime server
COPY --from=builder /app/client/dist ./dist
COPY --from=builder /app/client/server.js ./server.js
COPY --from=builder /app/client/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", "server.js"]
