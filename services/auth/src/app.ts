import cookie from "@fastify/cookie";
import { createLogger, createServiceApp } from "@gestor/shared";
import { sql } from "drizzle-orm";
import type { AuthConfig } from "./config.js";
import type { Db } from "./db/types.js";
import { authRoutes } from "./routes/auth.routes.js";
import { createAuthService } from "./services/auth.service.js";

export const SERVICE_NAME = "auth-service";

export interface AuthAppDeps {
  db: Db;
  config: AuthConfig;
  now?: () => Date;
}

export async function buildApp({ db, config, now }: AuthAppDeps) {
  const logger = createLogger(SERVICE_NAME, config.LOG_LEVEL);
  const app = await createServiceApp({
    name: SERVICE_NAME,
    logger,
    trustProxy: true, // solo es accesible desde el gateway (red privada)
    readinessChecks: {
      db: async () => {
        await db.execute(sql`select 1`);
      },
    },
  });
  await app.register(cookie);
  const service = createAuthService({ db, config, now });
  await app.register(authRoutes(service, config, now), { prefix: "/api/auth" });
  return app;
}
