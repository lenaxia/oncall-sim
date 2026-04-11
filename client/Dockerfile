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

# Install serve for static file serving
RUN npm install -g serve

COPY --from=builder /app/client/dist ./dist

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
