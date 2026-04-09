// logger.ts — browser logger shim matching the pino child-logger interface.
// Outputs to console.*. No pino dependency in the browser bundle.

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

interface LogBindings {
  component?: string;
  [key: string]: unknown;
}

export interface Logger {
  trace(obj: Record<string, unknown>, msg?: string): void;
  trace(msg: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
  fatal(obj: Record<string, unknown>, msg?: string): void;
  fatal(msg: string): void;
  child(bindings: LogBindings): Logger;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

function createLogger(
  bindings: LogBindings = {},
  minLevel: LogLevel = "info",
): Logger {
  const minRank = LEVEL_RANK[minLevel];

  function log(
    level: LogLevel,
    objOrMsg: Record<string, unknown> | string,
    msg?: string,
  ): void {
    if (LEVEL_RANK[level] < minRank) return;
    const data = typeof objOrMsg === "string" ? {} : objOrMsg;
    const message = typeof objOrMsg === "string" ? objOrMsg : (msg ?? "");
    const prefix = bindings.component ? `[${bindings.component}]` : "";
    const merged = { ...bindings, ...data };
    const extraKeys = Object.keys(merged).filter((k) => k !== "component");
    const extra =
      extraKeys.length > 0
        ? extraKeys.map((k) => `${k}=${JSON.stringify(merged[k])}`).join(" ")
        : "";
    const line = [prefix, message, extra].filter(Boolean).join(" ");

    switch (level) {
      case "trace":
      case "debug":
        console.debug(line);
        break;
      case "info":
        console.info(line);
        break;
      case "warn":
        console.warn(line);
        break;
      case "error":
      case "fatal":
        console.error(line);
        break;
    }
  }

  const impl: Logger = {
    trace(objOrMsg: Record<string, unknown> | string, msg?: string) {
      log("trace", objOrMsg, msg);
    },
    debug(objOrMsg: Record<string, unknown> | string, msg?: string) {
      log("debug", objOrMsg, msg);
    },
    info(objOrMsg: Record<string, unknown> | string, msg?: string) {
      log("info", objOrMsg, msg);
    },
    warn(objOrMsg: Record<string, unknown> | string, msg?: string) {
      log("warn", objOrMsg, msg);
    },
    error(objOrMsg: Record<string, unknown> | string, msg?: string) {
      log("error", objOrMsg, msg);
    },
    fatal(objOrMsg: Record<string, unknown> | string, msg?: string) {
      log("fatal", objOrMsg, msg);
    },
    child(childBindings) {
      return createLogger({ ...bindings, ...childBindings }, minLevel);
    },
  };
  return impl;
}

export const logger = createLogger();
