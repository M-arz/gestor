import type { FastifyBaseLogger, FastifyInstance } from "fastify";

/** Sobre de un evento en el bus. El id es el del registro del outbox: sirve para no aplicarlo dos veces. */
export interface EventoBus {
  id: string;
  tipo: string;
  payload: unknown;
  origen: string;
  creadoEn: string;
}
export interface Entrega {
  msgId: string;
  evento: EventoBus;
}

/** Transporte de eventos (Redis Streams en producción, en memoria en las pruebas). */
export interface Broker {
  publicar(e: EventoBus): Promise<void>;
  asegurarGrupo(grupo: string): Promise<void>;
  /** `pendientes: true` devuelve lo ya entregado a este consumidor y aún sin confirmar (reintentos). */
  leer(
    grupo: string,
    consumidor: string,
    bloqueoMs: number,
    pendientes: boolean,
  ): Promise<Entrega[]>;
  confirmar(grupo: string, msgId: string): Promise<void>;
  /** Cartera de eventos que no se pudieron procesar tras varios intentos. */
  descartar(grupo: string, e: Entrega, error: string): Promise<void>;
  cerrar(): Promise<void>;
}

/** Cada servicio guarda sus eventos en su propia base (outbox) y este contrato los entrega al bus. */
export interface OutboxStore {
  /**
   * Toma un lote de eventos pendientes dentro de una transacción (con bloqueo, para que dos réplicas no
   * publiquen lo mismo), llama a `publicar` y los marca como publicados. Devuelve cuántos procesó.
   */
  procesarLote(publicar: (lote: Omit<EventoBus, "origen">[]) => Promise<void>): Promise<number>;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Bucle {
  detener(): Promise<void>;
}

/** Publica del outbox al bus. Es "al menos una vez": los consumidores son idempotentes. */
export function iniciarPublicador(o: {
  store: OutboxStore;
  broker: Broker;
  origen: string;
  log: Pick<FastifyBaseLogger, "error" | "debug">;
  intervaloMs?: number;
}): Bucle {
  let activo = true;
  const espera = o.intervaloMs ?? 1000;
  const corrida = (async () => {
    while (activo) {
      try {
        const n = await o.store.procesarLote(async (lote) => {
          for (const e of lote) await o.broker.publicar({ ...e, origen: o.origen });
        });
        if (n === 0) await dormir(espera);
      } catch (err) {
        o.log.error({ err }, "no se pudieron publicar eventos; se reintenta");
        await dormir(espera * 3);
      }
    }
  })();
  return {
    async detener() {
      activo = false;
      await corrida;
    },
  };
}

/** Consume eventos y los aplica con `handler`. Confirma solo si se aplicó; si falla, reintenta. */
export function iniciarConsumidor(o: {
  broker: Broker;
  grupo: string;
  consumidor?: string;
  handler: (e: EventoBus) => Promise<unknown>;
  log: Pick<FastifyBaseLogger, "error" | "warn" | "debug">;
  maxIntentos?: number;
  bloqueoMs?: number;
}): Bucle {
  let activo = true;
  const consumidor = o.consumidor ?? `${o.grupo}-${process.pid}`;
  const maxIntentos = o.maxIntentos ?? 5;
  const bloqueo = o.bloqueoMs ?? 1000;
  const intentos = new Map<string, number>();

  const procesar = async (lote: Entrega[]) => {
    for (const en of lote) {
      try {
        await o.handler(en.evento);
        await o.broker.confirmar(o.grupo, en.msgId);
        intentos.delete(en.msgId);
      } catch (err) {
        const n = (intentos.get(en.msgId) ?? 0) + 1;
        intentos.set(en.msgId, n);
        if (n >= maxIntentos) {
          o.log.error(
            { err, evento: en.evento.tipo, id: en.evento.id },
            "evento descartado tras varios intentos",
          );
          await o.broker.descartar(o.grupo, en, String((err as Error)?.message ?? err));
          await o.broker.confirmar(o.grupo, en.msgId);
          intentos.delete(en.msgId);
        } else {
          o.log.warn(
            { err, evento: en.evento.tipo, id: en.evento.id, intento: n },
            "falló al aplicar un evento; se reintentará",
          );
        }
      }
    }
  };

  const corrida = (async () => {
    await o.broker.asegurarGrupo(o.grupo);
    while (activo) {
      try {
        const pend = await o.broker.leer(o.grupo, consumidor, 0, true);
        if (pend.length) {
          await procesar(pend);
          await dormir(200); // no martillar si algo sigue fallando
        }
        await procesar(await o.broker.leer(o.grupo, consumidor, bloqueo, false));
      } catch (err) {
        if (String((err as Error)?.message).includes("NOGROUP")) {
          // El flujo o el grupo desaparecieron (p. ej. Redis se reinició sin persistencia): se recrean y se sigue.
          o.log.warn({ grupo: o.grupo }, "el grupo de consumo no existe en el bus; se recrea");
          await o.broker.asegurarGrupo(o.grupo);
          continue;
        }
        o.log.error({ err }, "error leyendo del bus; se reintenta");
        await dormir(2000);
      }
    }
  })();
  return {
    async detener() {
      activo = false;
      await corrida;
    },
  };
}

/** Une publicador y consumidor a la vida de la aplicación: arrancan con ella y se apagan al cerrar. */
export function conectarBus(
  app: FastifyInstance,
  o: {
    broker: Broker;
    servicio: string;
    store: OutboxStore;
    handler?: (e: EventoBus) => Promise<unknown>;
    intervaloMs?: number;
    bloqueoMs?: number;
  },
): void {
  const bucles: Bucle[] = [
    iniciarPublicador({
      store: o.store,
      broker: o.broker,
      origen: o.servicio,
      log: app.log,
      intervaloMs: o.intervaloMs,
    }),
  ];
  if (o.handler) {
    bucles.push(
      iniciarConsumidor({
        broker: o.broker,
        grupo: o.servicio,
        handler: o.handler,
        log: app.log,
        bloqueoMs: o.bloqueoMs,
      }),
    );
  }
  app.addHook("onClose", async () => {
    await Promise.all(bucles.map((b) => b.detener()));
    await o.broker.cerrar();
  });
}

/** Broker en memoria para pruebas: mismo contrato, sin Redis. */
export class BrokerMemoria implements Broker {
  readonly flujo: Entrega[] = [];
  readonly muertos: { grupo: string; evento: EventoBus; error: string }[] = [];
  private seq = 0;
  private grupos = new Map<string, { pos: number; pend: Map<string, Entrega> }>();
  async publicar(e: EventoBus) {
    this.flujo.push({ msgId: String(++this.seq), evento: e });
  }
  async asegurarGrupo(grupo: string) {
    if (!this.grupos.has(grupo)) this.grupos.set(grupo, { pos: 0, pend: new Map() });
  }
  /** Simula que Redis perdió los grupos (reinicio sin persistencia). */
  perderGrupos() {
    this.grupos.clear();
  }
  async leer(grupo: string, _c: string, bloqueoMs: number, pendientes: boolean) {
    const g = this.grupos.get(grupo);
    if (!g) throw new Error(`NOGROUP No such consumer group '${grupo}'`);
    if (pendientes) return [...g.pend.values()];
    if (g.pos >= this.flujo.length) {
      await dormir(Math.min(bloqueoMs, 20));
      return [];
    }
    const lote = this.flujo.slice(g.pos);
    g.pos = this.flujo.length;
    for (const l of lote) g.pend.set(l.msgId, l);
    return lote;
  }
  async confirmar(grupo: string, msgId: string) {
    this.grupos.get(grupo)?.pend.delete(msgId);
  }
  async descartar(grupo: string, e: Entrega, error: string) {
    this.muertos.push({ grupo, evento: e.evento, error });
  }
  async cerrar() {}
}
