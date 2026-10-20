import { startService } from "@gestor/shared";
import { buildApp } from "./app.js";
import { loadAuthConfig } from "./config.js";
import { createDb } from "./db/client.js";

const config = loadAuthConfig();
const { db } = createDb(config.DATABASE_URL);
const app = await buildApp({ db, config });
await startService(app, config.PORT);
