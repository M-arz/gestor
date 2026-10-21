import cors from "@fastify/cors";
import httpProxy from "@fastify/http-proxy";
import rateLimit from "@fastify/rate-limit";
import {
  AppError,
  createLogger,
  createServiceApp,
  Errors,
  bearerToken,
  verifyAccessToken,
} from "@gestor/shared";
import type { FastifyRequest } from "fastify";

export const SERVICE_NAME = "gateway-service";

export interface GatewayOptions {
  logLevel?: string;
  jwtSecret: string;
  authUrl: string;
  teamsUrl: string;
  corsOrigins: string[];
  trustProxy?: boolean;
  generalLimitPerMin?: number;
  authLimitPerMin?: number;
  /** Máximo del cuerpo en bytes (las subidas de imágenes pasan por aquí). */
  bodyLimit?: number;
  now?: () => Date;
}

/** Rutas de /api que no exigen sesión. Todo lo demás de /api exige un token válido. */
const AUTH_SENSIBLES = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/register-admin",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
]);
const AUTH_PUBLICAS = new Set([...AUTH_SENSIBLES, "/api/auth/refresh", "/api/auth/logout"]);

const pathOf = (req: Pick<FastifyRequest, "url">) =>
  (req.url.split("?")[0] ?? "").replace(/\/+$/, "");
const esPublica = (path: string) => AUTH_PUBLICAS.has(path) || path.startsWith("/api/public/");

export async function buildApp(opts: GatewayOptions) {
  const logger = createLogger(SERVICE_NAME, opts.logLevel ?? "info");
  const app = await createServiceApp({
    name: SERVICE_NAME,
    logger,
    trustProxy: opts.trustProxy,
    bodyLimit: opts.bodyLimit ?? 3 * 1024 * 1024,
  });
  const now = opts.now ?? (() => new Date());

  await app.register(cors, {
    origin: opts.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["x-correlation-id"],
  });

  // Límite por IP, con un cupo más estricto para login, registro y recuperación.
  const sensible = (req: FastifyRequest) => AUTH_SENSIBLES.has(pathOf(req));
  await app.register(rateLimit, {
    global: true,
    timeWindow: "1 minute",
    max: (req) => (sensible(req) ? (opts.authLimitPerMin ?? 10) : (opts.generalLimitPerMin ?? 300)),
    keyGenerator: (req) => `${req.ip}:${sensible(req) ? "auth" : "general"}`,
  });

  // Validación de la sesión antes de reenviar nada. Cada servicio vuelve a verificar el rol.
  // El proxy reenvía el cuerpo como flujo sin leerlo, así que Fastify no aplica el límite:
  // se comprueba aquí con Content-Length para cortar cuanto antes.
  const limite = opts.bodyLimit ?? 3 * 1024 * 1024;
  app.addHook("onRequest", async (req) => {
    if (Number(req.headers["content-length"] ?? 0) > limite) {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "El archivo o la solicitud es demasiado grande");
    }
    const path = pathOf(req);
    if (!path.startsWith("/api/") || req.method === "OPTIONS" || esPublica(path)) return;
    const token = bearerToken(req);
    if (!token) throw Errors.unauthorized();
    await verifyAccessToken(token, opts.jwtSecret, now());
  });

  // La IP real y el id de correlación viajan hacia los servicios internos.
  const replyOptions = {
    rewriteRequestHeaders: (req: unknown, headers: Record<string, unknown>) => ({
      ...headers,
      "x-forwarded-for": (req as FastifyRequest).ip,
      "x-correlation-id": String((req as FastifyRequest).id),
    }),
  };
  const proxy = (prefix: string, upstream: string) =>
    app.register(httpProxy, { upstream, prefix, rewritePrefix: prefix, replyOptions });

  await proxy("/api/auth", opts.authUrl);
  await proxy("/api/teams", opts.teamsUrl);
  // Vistas públicas (solo lectura, sin sesión). matches-service sumará las suyas en la fase 4.
  await proxy("/api/public/equipos", opts.teamsUrl);
  await proxy("/api/public/escudos", opts.teamsUrl);

  return app;
}
