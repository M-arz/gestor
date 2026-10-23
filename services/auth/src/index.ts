import { BrokerRedis, conectarBus, startService } from "@gestor/shared";
import { buildApp } from "./app.js";
import { crearOutboxStore } from "./bus.js";
import { loadAuthConfig } from "./config.js";
import { createDb } from "./db/client.js";

const config = loadAuthConfig();
const { db } = createDb(config.DATABASE_URL);
const app = await buildApp({ db, config });

// Bus de eventos: publica el outbox de este servicio.
if (config.REDIS_URL) {
  conectarBus(app, {
    broker: new BrokerRedis(config.REDIS_URL),
    servicio: "auth",
    store: crearOutboxStore(db),
  });
} else {
  app.log.warn("REDIS_URL no configurada: los eventos no se publican ni se consumen");
}
await startService(app, config.PORT);
