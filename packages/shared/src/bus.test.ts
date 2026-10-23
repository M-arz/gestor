import { describe, expect, it } from "vitest";
import { BrokerMemoria, iniciarConsumidor, iniciarPublicador, type OutboxStore } from "./bus.js";

const log = { error: () => {}, warn: () => {}, debug: () => {} };
const esperar = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
  if (!cond()) throw new Error("tiempo agotado");
};

function storeFalso(eventos: { id: string; tipo: string; payload: unknown; creadoEn: string }[]) {
  const pendientes = [...eventos];
  const publicados: string[] = [];
  let fallar = 0;
  const store: OutboxStore = {
    async procesarLote(publicar) {
      if (pendientes.length === 0) return 0;
      const lote = pendientes.slice(0, 100);
      await publicar(lote); // si lanza, no se marcan como publicados
      pendientes.splice(0, lote.length);
      publicados.push(...lote.map((e) => e.id));
      return lote.length;
    },
  };
  return {
    store,
    publicados,
    pendientes,
    hacerFallar: (n: number) => (fallar = n),
    get fallar() {
      return fallar;
    },
  };
}

describe("bus de eventos", () => {
  it("publica el outbox y cada servicio recibe todos los eventos, en orden", async () => {
    const broker = new BrokerMemoria();
    const s = storeFalso(
      [1, 2, 3].map((n) => ({ id: `e${n}`, tipo: "t", payload: { n }, creadoEn: "x" })),
    );
    const pub = iniciarPublicador({ store: s.store, broker, origen: "auth", log, intervaloMs: 5 });
    const a: string[] = [];
    const b: string[] = [];
    const ca = iniciarConsumidor({
      broker,
      grupo: "teams",
      handler: async (e) => void a.push(e.id),
      log,
      bloqueoMs: 5,
    });
    const cb = iniciarConsumidor({
      broker,
      grupo: "matches",
      handler: async (e) => void b.push(e.id),
      log,
      bloqueoMs: 5,
    });
    await esperar(() => a.length === 3 && b.length === 3);
    expect(a).toEqual(["e1", "e2", "e3"]);
    expect(b).toEqual(["e1", "e2", "e3"]);
    expect(s.publicados).toEqual(["e1", "e2", "e3"]);
    expect(broker.flujo[0]?.evento.origen).toBe("auth");
    await Promise.all([pub.detener(), ca.detener(), cb.detener()]);
  });

  it("si publicar falla, los eventos NO se pierden: se reintentan", async () => {
    let intentos = 0;
    const broker = new BrokerMemoria();
    const original = broker.publicar.bind(broker);
    broker.publicar = async (e) => {
      if (++intentos === 1) throw new Error("redis caído");
      return original(e);
    };
    const s = storeFalso([{ id: "e1", tipo: "t", payload: {}, creadoEn: "x" }]);
    const pub = iniciarPublicador({ store: s.store, broker, origen: "teams", log, intervaloMs: 2 });
    await esperar(() => broker.flujo.length === 1, 3000);
    expect(s.publicados).toEqual(["e1"]);
    await pub.detener();
  });

  it("si el consumidor falla, reintenta y no confirma hasta que lo logra", async () => {
    const broker = new BrokerMemoria();
    await broker.publicar({ id: "e1", tipo: "t", payload: {}, origen: "x", creadoEn: "x" });
    let llamadas = 0;
    const c = iniciarConsumidor({
      broker,
      grupo: "g",
      log,
      bloqueoMs: 5,
      handler: async () => {
        if (++llamadas < 3) throw new Error("base de datos ocupada");
      },
    });
    await esperar(() => llamadas >= 3, 4000);
    expect(broker.muertos.length).toBe(0);
    await c.detener();
  });

  it("un evento que siempre falla va a la cola de descartados y no bloquea a los demás", async () => {
    const broker = new BrokerMemoria();
    await broker.publicar({ id: "malo", tipo: "t", payload: {}, origen: "x", creadoEn: "x" });
    await broker.publicar({ id: "bueno", tipo: "t", payload: {}, origen: "x", creadoEn: "x" });
    const ok: string[] = [];
    const c = iniciarConsumidor({
      broker,
      grupo: "g",
      log,
      bloqueoMs: 5,
      maxIntentos: 3,
      handler: async (e) => {
        if (e.id === "malo") throw new Error("payload inválido");
        ok.push(e.id);
      },
    });
    await esperar(() => broker.muertos.length === 1 && ok.includes("bueno"), 4000);
    expect(broker.muertos[0]).toMatchObject({ grupo: "g", error: "payload inválido" });
    expect(broker.muertos[0]?.evento.id).toBe("malo");
    await c.detener();
  });

  it("si Redis pierde el grupo de consumo, el consumidor lo recrea y sigue recibiendo", async () => {
    const broker = new BrokerMemoria();
    const recibidos: string[] = [];
    const c = iniciarConsumidor({
      broker,
      grupo: "g",
      handler: async (e) => void recibidos.push(e.id),
      log,
      bloqueoMs: 5,
    });
    await broker.publicar({ id: "a", tipo: "t", payload: {}, origen: "x", creadoEn: "x" });
    await esperar(() => recibidos.includes("a"));
    broker.perderGrupos(); // como un reinicio de Redis sin persistencia
    await broker.publicar({ id: "b", tipo: "t", payload: {}, origen: "x", creadoEn: "x" });
    await esperar(() => recibidos.includes("b"), 4000);
    await c.detener();
  });
});
