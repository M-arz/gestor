import { createLogger, createServiceApp } from "@gestor/shared";
import { sql } from "drizzle-orm";
import type { MatchesConfig } from "./config.js";
import type { Db } from "./db/types.js";
import { matchesRoutes, publicRoutes } from "./routes/matches.routes.js";
import { crearMatchesService } from "./services/matches.service.js";

export const SERVICE_NAME = "matches-service";

export interface MatchesAppDeps {
  db: Db;
  config: MatchesConfig;
  now?: () => Date;
}

export async function buildApp({ db, config, now = () => new Date() }: MatchesAppDeps) {
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
  const service = crearMatchesService({ db, now });
  await app.register(matchesRoutes(service, config, now), { prefix: "/api/matches" });
  await app.register(publicRoutes(service), { prefix: "/api/public" });
  return Object.assign(app, { service });
}
