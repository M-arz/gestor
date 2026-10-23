import { loadConfig, startService, conectarBus, BrokerRedis } from "@gestor/shared";
import { buildApp } from "./app.js";
import { crearOutboxStore } from "./bus.js";

const config = loadConfig();
const app = await buildApp(config.LOG_LEVEL);

// Conectar al bus de eventos si hay Redis URL
if (config.REDIS_URL) {
  conectarBus(app, {
    broker: new BrokerRedis(config.REDIS_URL),
    servicio: "discipline",
    store: crearOutboxStore(),
  });
} else {
  app.log.warn("REDIS_URL no configurada: los eventos no se publicarán ni consumirán");
}

await startService(app, config.PORT);