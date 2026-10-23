import multipart from "@fastify/multipart";
import { createLogger, createServiceApp } from "@gestor/shared";
import { sql } from "drizzle-orm";
import type { TeamsConfig } from "./config.js";
import type { Db } from "./db/types.js";
import { publicRoutes, teamsRoutes } from "./routes/teams.routes.js";
import { crearCifrador } from "./security/documento.js";
import { createTeamsService } from "./services/teams.service.js";
import type { Almacenamiento } from "./storage/almacenamiento.js";

export const SERVICE_NAME = "teams-service";

export interface TeamsAppDeps {
  db: Db;
  config: TeamsConfig;
  almacenamiento: Almacenamiento;
  now?: () => Date;
}

export async function buildApp({ db, config, almacenamiento, now }: TeamsAppDeps) {
  const logger = createLogger(SERVICE_NAME, config.LOG_LEVEL);
  const app = await createServiceApp({
    name: SERVICE_NAME,
    logger,
    trustProxy: true, // solo es accesible desde el gateway (red privada)
    bodyLimit: config.MAX_UPLOAD_BYTES + 64 * 1024, // la imagen más los encabezados del formulario
    readinessChecks: {
      db: async () => {
        await db.execute(sql`select 1`);
      },
    },
  });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1, fields: 0 },
  });

  const service = createTeamsService({
    db,
    almacenamiento,
    cifrador: crearCifrador(config.DOCUMENTO_CLAVE, config.DOCUMENTO_HASH_CLAVE),
    now,
  });
  await app.register(teamsRoutes(service, config, now), { prefix: "/api/teams" });
  await app.register(publicRoutes(service), { prefix: "/api/public" });
  return Object.assign(app, { service });
}
