import { Redis } from "ioredis";
import type { Broker, Entrega, EventoBus } from "./bus.js";

const FLUJO = "gestor.eventos";
const FLUJO_MUERTOS = "gestor.eventos.muertos";

type Mensajes = [string, [string, string[]][]][] | null;

function aEntrega([msgId, campos]: [string, string[]]): Entrega {
  const c: Record<string, string> = {};
  for (let i = 0; i < campos.length; i += 2) c[campos[i]!] = campos[i + 1]!;
  return {
    msgId,
    evento: {
      id: c.id ?? msgId,
      tipo: c.tipo ?? "",
      payload: JSON.parse(c.payload ?? "null"),
      origen: c.origen ?? "",
      creadoEn: c.creadoEn ?? "",
    },
  };
}

/** Redis Streams: un solo flujo, un grupo de consumo por servicio (cada servicio ve todos los eventos). */
export class BrokerRedis implements Broker {
  private readonly escritura: Redis;
  private readonly lectura: Redis; // las lecturas con bloqueo necesitan su propia conexión

  constructor(url: string) {
    this.escritura = new Redis(url, { maxRetriesPerRequest: null });
    this.lectura = this.escritura.duplicate();
  }

  async publicar(e: EventoBus) {
    await this.escritura.xadd(
      FLUJO,
      "MAXLEN",
      "~",
      100_000,
      "*",
      "id",
      e.id,
      "tipo",
      e.tipo,
      "payload",
      JSON.stringify(e.payload ?? null),
      "origen",
      e.origen,
      "creadoEn",
      e.creadoEn,
    );
  }

  async asegurarGrupo(grupo: string) {
    try {
      await this.escritura.xgroup("CREATE", FLUJO, grupo, "0", "MKSTREAM");
    } catch (err) {
      if (!String((err as Error).message).includes("BUSYGROUP")) throw err; // ya existía
    }
  }

  async leer(
    grupo: string,
    consumidor: string,
    bloqueoMs: number,
    pendientes: boolean,
  ): Promise<Entrega[]> {
    const args: (string | number)[] = ["GROUP", grupo, consumidor, "COUNT", 50];
    if (!pendientes && bloqueoMs > 0) args.push("BLOCK", bloqueoMs);
    args.push("STREAMS", FLUJO, pendientes ? "0" : ">");
    const r = (await (
      this.lectura as unknown as { xreadgroup: (...a: (string | number)[]) => Promise<Mensajes> }
    ).xreadgroup(...args)) as Mensajes;
    return r?.[0]?.[1].map(aEntrega) ?? [];
  }

  async confirmar(grupo: string, msgId: string) {
    await this.escritura.xack(FLUJO, grupo, msgId);
  }

  async descartar(grupo: string, e: Entrega, error: string) {
    await this.escritura.xadd(
      FLUJO_MUERTOS,
      "MAXLEN",
      "~",
      10_000,
      "*",
      "grupo",
      grupo,
      "id",
      e.evento.id,
      "tipo",
      e.evento.tipo,
      "payload",
      JSON.stringify(e.evento.payload ?? null),
      "error",
      error,
    );
  }

  async cerrar() {
    this.lectura.disconnect();
    await this.escritura.quit().catch(() => undefined);
  }
}
