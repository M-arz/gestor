import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/types.js";
import { codigosAccesoAdmin, recuperacionesContrasena, sesiones } from "../db/schema.js";

export const sesionesRepo = {
  insert: (db: Db, row: typeof sesiones.$inferInsert) => db.insert(sesiones).values(row),
  async findByHash(db: Db, tokenHash: string) {
    const rows = await db.select().from(sesiones).where(eq(sesiones.tokenHash, tokenHash)).limit(1);
    return rows[0];
  },
  /** Revoca solo si seguía vigente. Devuelve true si esta llamada la revocó (evita doble uso). */
  async revocar(db: Db, id: string, ahora: Date, reemplazadaPor?: string) {
    const r = await db
      .update(sesiones)
      .set({ revocadoEn: ahora, reemplazadoPor: reemplazadaPor ?? null })
      .where(and(eq(sesiones.id, id), isNull(sesiones.revocadoEn)))
      .returning({ id: sesiones.id });
    return r.length === 1;
  },
  revocarFamilia: (db: Db, familiaId: string, ahora: Date) =>
    db
      .update(sesiones)
      .set({ revocadoEn: ahora })
      .where(and(eq(sesiones.familiaId, familiaId), isNull(sesiones.revocadoEn))),
  revocarDeUsuario: (db: Db, usuarioId: string, ahora: Date) =>
    db
      .update(sesiones)
      .set({ revocadoEn: ahora })
      .where(and(eq(sesiones.usuarioId, usuarioId), isNull(sesiones.revocadoEn))),
};

export const recuperacionesRepo = {
  insert: (db: Db, row: typeof recuperacionesContrasena.$inferInsert) =>
    db.insert(recuperacionesContrasena).values(row),
  async findByHash(db: Db, tokenHash: string) {
    const rows = await db
      .select()
      .from(recuperacionesContrasena)
      .where(eq(recuperacionesContrasena.tokenHash, tokenHash))
      .limit(1);
    return rows[0];
  },
  async marcarUsada(db: Db, id: string, ahora: Date) {
    const r = await db
      .update(recuperacionesContrasena)
      .set({ usadoEn: ahora })
      .where(and(eq(recuperacionesContrasena.id, id), isNull(recuperacionesContrasena.usadoEn)))
      .returning({ id: recuperacionesContrasena.id });
    return r.length === 1;
  },
};

export const codigosRepo = {
  insert: (db: Db, row: typeof codigosAccesoAdmin.$inferInsert) =>
    db.insert(codigosAccesoAdmin).values(row),
  async findById(db: Db, id: string) {
    const rows = await db
      .select()
      .from(codigosAccesoAdmin)
      .where(eq(codigosAccesoAdmin.id, id))
      .limit(1);
    return rows[0];
  },
  async sumarFallo(db: Db, id: string, actuales: number) {
    await db
      .update(codigosAccesoAdmin)
      .set({ intentosFallidos: actuales + 1 })
      .where(eq(codigosAccesoAdmin.id, id));
  },
  async consumir(db: Db, id: string, usuarioId: string, ahora: Date) {
    const r = await db
      .update(codigosAccesoAdmin)
      .set({ usadoEn: ahora, usadoPor: usuarioId })
      .where(and(eq(codigosAccesoAdmin.id, id), isNull(codigosAccesoAdmin.usadoEn)))
      .returning({ id: codigosAccesoAdmin.id });
    return r.length === 1;
  },
};
