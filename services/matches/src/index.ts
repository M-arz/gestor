import { BrokerRedis, conectarBus, startService } from "@gestor/shared";
import { buildApp } from "./app.js";
import { crearOutboxStore } from "./bus.js";
import { loadMatchesConfig } from "./config.js";
import { createDb } from "./db/client.js";

const config = loadMatchesConfig();
const { db } = createDb(config.DATABASE_URL);
const app = await buildApp({ db, config });

// Bus de eventos: publica el outbox de este servicio y aplica los eventos de los demás.
if (config.REDIS_URL) {
  conectarBus(app, {
    broker: new BrokerRedis(config.REDIS_URL),
    servicio: "matches",
    store: crearOutboxStore(db),
    handler: (e) => app.service.eventos.aplicar(e),
  });
} else {
  app.log.warn("REDIS_URL no configurada: los eventos no se publican ni se consumen");
}
await startService(app, config.PORT);
