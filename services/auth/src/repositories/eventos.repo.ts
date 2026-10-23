import { randomUUID } from "node:crypto";
import type { Db } from "../db/types.js";
import { auditoriaAuth, consentimientos, eventosSalida } from "../db/schema.js";

export const eventosRepo = {
  auditoria: (
    db: Db,
    a: {
      usuarioId?: string | null;
      accion: string;
      detalle?: unknown;
      ipHash: string | null;
      ahora: Date;
    },
  ) =>
    db.insert(auditoriaAuth).values({
      id: randomUUID(),
      usuarioId: a.usuarioId ?? null,
      accion: a.accion,
      detalle: a.detalle ?? null,
      ipHash: a.ipHash,
      creadoEn: a.ahora,
    }),
  consentimiento: (
    db: Db,
    c: { usuarioId: string; version: string; ipHash: string | null; ahora: Date },
  ) =>
    db.insert(consentimientos).values({
      id: randomUUID(),
      usuarioId: c.usuarioId,
      versionPolitica: c.version,
      aceptadoEn: c.ahora,
      ipHash: c.ipHash,
    }),
  outbox: (db: Db, tipo: string, payload: unknown, ahora: Date) =>
    db.insert(eventosSalida).values({ id: randomUUID(), tipo, payload, creadoEn: ahora }),
};
