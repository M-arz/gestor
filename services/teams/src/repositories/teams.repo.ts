import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  auditoriaTeams,
  copiaAdministradoresTorneo,
  copiaInscripciones,
  equipos,
  eventosProcesados,
  eventosSalida,
  jugadores,
} from "../db/schema.js";
import type { Db } from "../db/types.js";

export type Equipo = typeof equipos.$inferSelect;
export type Jugador = typeof jugadores.$inferSelect;

const ESTADOS_VISIBLES = ["pendiente", "aceptada"];

export const equiposRepo = {
  async findById(db: Db, id: string) {
    const r = await db
      .select()
      .from(equipos)
      .where(and(eq(equipos.id, id), isNull(equipos.eliminadoEn)))
      .limit(1);
    return r[0];
  },
  listarDeDelegado: (db: Db, delegadoId: string) =>
    db
      .select()
      .from(equipos)
      .where(and(eq(equipos.delegadoId, delegadoId), isNull(equipos.eliminadoEn)))
      .orderBy(equipos.nombre),
  /** Equipos inscritos en torneos que el administrador gestiona. */
  async listarDeAdmin(db: Db, adminId: string): Promise<Equipo[]> {
    const r = await db
      .selectDistinct({ equipo: equipos })
      .from(equipos)
      .innerJoin(copiaInscripciones, eq(copiaInscripciones.equipoId, equipos.id))
      .innerJoin(
        copiaAdministradoresTorneo,
        and(
          eq(copiaAdministradoresTorneo.torneoId, copiaInscripciones.torneoId),
          eq(copiaAdministradoresTorneo.usuarioId, adminId),
        ),
      )
      .where(
        and(isNull(equipos.eliminadoEn), inArray(copiaInscripciones.estado, ESTADOS_VISIBLES)),
      );
    return r.map((x) => x.equipo).sort((a, b) => a.nombre.localeCompare(b.nombre));
  },
  async esAdminDeEquipo(db: Db, adminId: string, equipoId: string): Promise<boolean> {
    const r = await db
      .select({ torneoId: copiaInscripciones.torneoId })
      .from(copiaInscripciones)
      .innerJoin(
        copiaAdministradoresTorneo,
        and(
          eq(copiaAdministradoresTorneo.torneoId, copiaInscripciones.torneoId),
          eq(copiaAdministradoresTorneo.usuarioId, adminId),
        ),
      )
      .where(
        and(
          eq(copiaInscripciones.equipoId, equipoId),
          inArray(copiaInscripciones.estado, ESTADOS_VISIBLES),
        ),
      )
      .limit(1);
    return r.length > 0;
  },
  insert: (db: Db, row: typeof equipos.$inferInsert) => db.insert(equipos).values(row).returning(),
  update: (db: Db, id: string, patch: Partial<typeof equipos.$inferInsert>) =>
    db
      .update(equipos)
      .set({ ...patch, version: sql`${equipos.version} + 1` })
      .where(eq(equipos.id, id))
      .returning(),
  marcarSinDelegado: (db: Db, delegadoId: string, ahora: Date) =>
    db
      .update(equipos)
      .set({ estado: "sin_delegado", actualizadoEn: ahora, version: sql`${equipos.version} + 1` })
      .where(
        and(
          eq(equipos.delegadoId, delegadoId),
          isNull(equipos.eliminadoEn),
          eq(equipos.estado, "activo"),
        ),
      )
      .returning(),
};

export const jugadoresRepo = {
  async findById(db: Db, id: string) {
    const r = await db
      .select()
      .from(jugadores)
      .where(and(eq(jugadores.id, id), isNull(jugadores.eliminadoEn)))
      .limit(1);
    return r[0];
  },
  listarDeEquipo: (db: Db, equipoId: string) =>
    db
      .select()
      .from(jugadores)
      .where(and(eq(jugadores.equipoId, equipoId), isNull(jugadores.eliminadoEn)))
      .orderBy(jugadores.dorsal),
  insert: (db: Db, row: typeof jugadores.$inferInsert) =>
    db.insert(jugadores).values(row).returning(),
  update: (db: Db, id: string, patch: Partial<typeof jugadores.$inferInsert>) =>
    db
      .update(jugadores)
      .set({ ...patch, version: sql`${jugadores.version} + 1` })
      .where(eq(jugadores.id, id))
      .returning(),
};

export const eventosRepo = {
  auditoria: (
    db: Db,
    a: { usuarioId?: string; equipoId?: string; jugadorId?: string; accion: string; ahora: Date },
  ) =>
    db.insert(auditoriaTeams).values({
      id: randomUUID(),
      usuarioId: a.usuarioId ?? null,
      equipoId: a.equipoId ?? null,
      jugadorId: a.jugadorId ?? null,
      accion: a.accion,
      creadoEn: a.ahora,
    }),
  outbox: (db: Db, tipo: string, payload: unknown, ahora: Date) =>
    db.insert(eventosSalida).values({ id: randomUUID(), tipo, payload, creadoEn: ahora }),
  /** true si el evento es nuevo (y queda marcado); false si ya se había aplicado. */
  async marcarProcesado(db: Db, eventoId: string): Promise<boolean> {
    const r = await db
      .insert(eventosProcesados)
      .values({ eventoId })
      .onConflictDoNothing()
      .returning({ id: eventosProcesados.eventoId });
    return r.length === 1;
  },
};
