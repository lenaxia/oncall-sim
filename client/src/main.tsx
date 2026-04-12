import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

// Suppress the transient Recharts ResponsiveContainer 0×0 warning that fires
// on the first React dev-mode paint before ResizeObserver has run. The fix
// (minWidth={1} + min-w-0) is already in place — this warning is noise only.
const _warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (
    typeof args[0] === "string" &&
    args[0].includes("of chart should be greater than 0")
  )
    return;
  _warn(...args);
};

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
