import type { OutboxStore } from "@gestor/shared";
import { asc, inArray, isNull } from "drizzle-orm";
import { eventosSalida } from "./db/schema.js";
import type { Db } from "./db/types.js";

/** Entrega al bus los eventos que este servicio guardó en su outbox. */
export function crearOutboxStore(db: Db): OutboxStore {
  return {
    async procesarLote(publicar) {
      return db.transaction(async (tx) => {
        const filas = await tx
          .select()
          .from(eventosSalida)
          .where(isNull(eventosSalida.publicadoEn))
          .orderBy(asc(eventosSalida.creadoEn), asc(eventosSalida.id))
          .limit(100)
          .for("update", { skipLocked: true }); // con varias réplicas, cada una toma lotes distintos
        if (filas.length === 0) return 0;
        await publicar(
          filas.map((f) => ({
            id: f.id,
            tipo: f.tipo,
            payload: f.payload,
            creadoEn: f.creadoEn.toISOString(),
          })),
        );
        await tx
          .update(eventosSalida)
          .set({ publicadoEn: new Date() })
          .where(
            inArray(
              eventosSalida.id,
              filas.map((f) => f.id),
            ),
          );
        return filas.length;
      });
    },
  };
}
