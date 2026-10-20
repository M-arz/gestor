import { pino, type Logger } from "pino";

/** Log estructurado (JSON) con campos sensibles ocultos. */
export function createLogger(service: string, level = "info"): Logger {
  return pino({
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.contrasena",
        "*.token",
        "*.documento",
      ],
      censor: "[REDACTED]",
    },
  });
}
