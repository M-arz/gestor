import { randomUUID } from "node:crypto";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { ZodError } from "zod";
import { AppError, type ErrorBody } from "./errors.js";

const STATUS_CODES: Record<number, string> = {
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  413: "PAYLOAD_TOO_LARGE",
  429: "TOO_MANY_REQUESTS",
};

export interface ServiceOptions {
  name: string;
  logger: Logger;
  /** true si el servicio está detrás de un proxy de confianza (gateway). */
  trustProxy?: boolean;
  /** Tamaño máximo del cuerpo en bytes (por defecto 1 MB). */
  bodyLimit?: number;
  /** Comprobaciones para /ready (p. ej. base de datos, Redis). */
  readinessChecks?: Record<string, () => Promise<void>>;
}

/**
 * Plantilla común de servicio: seguridad de cabeceras, identificador de
 * correlación, errores uniformes y /health + /ready.
 */
export async function createServiceApp(opts: ServiceOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: opts.logger as FastifyBaseLogger,
    requestIdHeader: "x-correlation-id",
    genReqId: () => randomUUID(),
    bodyLimit: opts.bodyLimit ?? 1_048_576,
    trustProxy: opts.trustProxy ?? false,
  });

  await app.register(helmet);

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-correlation-id", req.id);
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    const correlationId = String(req.id);
    let status = 500;
    let body: ErrorBody["error"] = {
      code: "INTERNAL_ERROR",
      message: "Error interno",
      correlationId,
    };

    if (err instanceof ZodError) {
      status = 400;
      body = {
        code: "VALIDATION_ERROR",
        message: "Datos inválidos",
        correlationId,
        details: err.issues,
      };
    } else if (err instanceof AppError) {
      status = err.statusCode;
      body = { code: err.code, message: err.message, correlationId, details: err.details };
    } else {
      const e = err as { statusCode?: number; message?: string };
      if (typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) {
        status = e.statusCode;
        body = {
          code: STATUS_CODES[status] ?? "BAD_REQUEST",
          message: e.message ?? "Solicitud inválida",
          correlationId,
        };
      }
    }

    if (status >= 500) req.log.error({ err }, "error no controlado");
    return reply.status(status).send({ error: body } satisfies ErrorBody);
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Ruta no encontrada", correlationId: String(req.id) },
    } satisfies ErrorBody),
  );

  app.get("/health", { logLevel: "silent" }, async () => ({
    status: "ok",
    service: opts.name,
    uptime: Math.round(process.uptime()),
  }));

  app.get("/ready", { logLevel: "silent" }, async (_req, reply) => {
    const entries = Object.entries(opts.readinessChecks ?? {});
    const results = await Promise.allSettled(entries.map(([, check]) => check()));
    const checks = Object.fromEntries(
      entries.map(([name], i) => [name, results[i]?.status === "fulfilled" ? "ok" : "fail"]),
    );
    const ready = results.every((r) => r.status === "fulfilled");
    return reply.status(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready", checks });
  });

  return app;
}

/** Arranca el servidor y lo apaga de forma ordenada con SIGTERM/SIGINT. */
export async function startService(app: FastifyInstance, port: number): Promise<void> {
  await app.listen({ port, host: "0.0.0.0" });
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "apagando");
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "error al apagar");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
