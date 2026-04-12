// server.js — minimal runtime server for the client SPA.
//
// Serves the Vite-built static files and injects runtime config
// directly into index.html as window.__CONFIG__ so the browser
// never needs a separate fetch.

import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist");
const PORT = parseInt(process.env.PORT ?? "3000", 10);

const app = express();

// Runtime config — read once at startup.
const CONFIG = {
  debug: process.env.DEBUG === "true",
};

const CONFIG_SCRIPT = `<script>window.__CONFIG__ = ${JSON.stringify(CONFIG)};</script>`;

// Read index.html once and inject config script before </head>.
const indexHtml = readFileSync(join(DIST, "index.html"), "utf-8").replace(
  "</head>",
  `${CONFIG_SCRIPT}</head>`,
);

// Serve static assets (everything except index.html) with long cache.
app.use(
  express.static(DIST, {
    maxAge: "1y",
    immutable: true,
    index: false, // we handle index.html ourselves
  }),
);

// All routes get the config-injected index.html (SPA fallback).
app.use((_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "text/html");
  res.send(indexHtml);
});

app.listen(PORT, () => {
  console.log(`client serving on :${PORT}  debug=${CONFIG.debug}`);
});
