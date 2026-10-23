import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  administradoresTorneo,
  auditoriaTorneos,
  copiaEquipos,
  copiaUsuariosAdmin,
  eventosSalida,
  inscripciones,
  torneos,
} from "../db/schema.js";
import type { Db } from "../db/types.js";

export type Torneo = typeof torneos.$inferSelect;
export type Inscripcion = typeof inscripciones.$inferSelect;

export const torneosRepo = {
  async findById(db: Db, id: string) {
    const r = await db.select().from(torneos).where(eq(torneos.id, id)).limit(1);
    return r[0];
  },
  update: (db: Db, id: string, patch: Partial<typeof torneos.$inferInsert>) =>
    db
      .update(torneos)
      .set({ ...patch, version: sql`${torneos.version} + 1` })
      .where(eq(torneos.id, id))
      .returning(),
};

/** Serializa las operaciones que reparten plantillas, resultados o administradores de un torneo. */
export async function bloquearTorneo(tx: Db, torneoId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${torneoId}))`);
}

export async function esAdminActivo(db: Db, torneoId: string, usuarioId: string): Promise<boolean> {
  const r = await db
    .select({ u: administradoresTorneo.usuarioId })
    .from(administradoresTorneo)
    .where(
      and(
        eq(administradoresTorneo.torneoId, torneoId),
        eq(administradoresTorneo.usuarioId, usuarioId),
        isNull(administradoresTorneo.retiradoEn),
      ),
    )
    .limit(1);
  return r.length > 0;
}

export const eventosRepo = {
  outbox: (db: Db, tipo: string, payload: unknown, ahora: Date) =>
    db.insert(eventosSalida).values({ id: randomUUID(), tipo, payload, creadoEn: ahora }),
  auditoria: (
    db: Db,
    a: { torneoId?: string; usuarioId?: string; accion: string; detalle?: unknown; ahora: Date },
  ) =>
    db.insert(auditoriaTorneos).values({
      id: randomUUID(),
      torneoId: a.torneoId ?? null,
      usuarioId: a.usuarioId ?? null,
      accion: a.accion,
      detalle: a.detalle ?? null,
      creadoEn: a.ahora,
    }),
};

export function inscripcionesAceptadas(db: Db, torneoId: string) {
  return db
    .select()
    .from(inscripciones)
    .where(and(eq(inscripciones.torneoId, torneoId), eq(inscripciones.estado, "aceptada")))
    .orderBy(asc(inscripciones.creadoEn), asc(inscripciones.id));
}

export interface DatosEquipo {
  inscripcionId: string;
  equipoId: string;
  nombre: string;
  escudoUrl: string | null;
  delegadoId: string | null;
}

/** Nombre y escudo de los equipos, tomados de la copia local (sin llamar a teams-service). */
export async function datosEquipos(
  db: Db,
  inscripcionIds: string[],
): Promise<Map<string, DatosEquipo>> {
  const m = new Map<string, DatosEquipo>();
  if (inscripcionIds.length === 0) return m;
  const filas = await db
    .select({
      inscripcionId: inscripciones.id,
      equipoId: inscripciones.equipoId,
      nombre: copiaEquipos.nombre,
      escudoUrl: copiaEquipos.escudoUrl,
      delegadoId: copiaEquipos.delegadoId,
    })
    .from(inscripciones)
    .leftJoin(copiaEquipos, eq(copiaEquipos.equipoId, inscripciones.equipoId))
    .where(inArray(inscripciones.id, inscripcionIds));
  for (const f of filas) {
    m.set(f.inscripcionId, {
      inscripcionId: f.inscripcionId,
      equipoId: f.equipoId,
      nombre: f.nombre ?? "Equipo sin nombre",
      escudoUrl: f.escudoUrl ?? null,
      delegadoId: f.delegadoId ?? null,
    });
  }
  return m;
}

export async function adminsActivos(db: Db, torneoId: string) {
  return db
    .select({
      usuarioId: administradoresTorneo.usuarioId,
      agregadoEn: administradoresTorneo.agregadoEn,
      correo: copiaUsuariosAdmin.correo,
      nombre: copiaUsuariosAdmin.nombre,
    })
    .from(administradoresTorneo)
    .leftJoin(copiaUsuariosAdmin, eq(copiaUsuariosAdmin.usuarioId, administradoresTorneo.usuarioId))
    .where(
      and(eq(administradoresTorneo.torneoId, torneoId), isNull(administradoresTorneo.retiradoEn)),
    )
    .orderBy(asc(administradoresTorneo.agregadoEn));
}
