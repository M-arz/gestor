import { BrokerRedis, conectarBus, startService } from "@gestor/shared";
import { buildApp } from "./app.js";
import { crearOutboxStore } from "./bus.js";
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

// Bus de eventos: publica el outbox de este servicio y aplica los eventos de los demás.
if (config.REDIS_URL) {
  conectarBus(app, {
    broker: new BrokerRedis(config.REDIS_URL),
    servicio: "teams",
    store: crearOutboxStore(db),
    handler: (e) => app.service.aplicarEvento(e),
  });
} else {
  app.log.warn("REDIS_URL no configurada: los eventos no se publican ni se consumen");
}
await startService(app, config.PORT);
