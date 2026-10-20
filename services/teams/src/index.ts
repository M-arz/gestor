import { loadConfig, startService } from "@gestor/shared";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp(config.LOG_LEVEL);
await startService(app, config.PORT);
