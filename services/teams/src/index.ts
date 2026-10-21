import { startService } from "@gestor/shared";
import { buildApp } from "./app.js";
import { loadTeamsConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { AlmacenamientoLocal } from "./storage/almacenamiento.js";

const config = loadTeamsConfig();
const { db } = createDb(config.DATABASE_URL);
const app = await buildApp({
  db,
  config,
  almacenamiento: new AlmacenamientoLocal(config.STORAGE_DIR),
});
await startService(app, config.PORT);
