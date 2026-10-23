import { type AuthUser, Errors } from "@gestor/shared";
import type { Db } from "../db/types.js";
import { ESTADOS_TORNEO } from "../dominio.js";
import { esAdminActivo, type Torneo, torneosRepo } from "../repositories/matches.repo.js";

export interface Ctx {
  db: Db;
  now: () => Date;
}

export async function cargarTorneo(db: Db, id: string): Promise<Torneo> {
  const t = await torneosRepo.findById(db, id);
  if (!t) throw Errors.notFound("Torneo no encontrado");
  return t;
}

/**
 * Tener la cuenta `admin` no basta: hay que ser administrador de ESTE torneo.
 * Se comprueba con la lista local de administradores, sin llamar a otro servicio.
 */
export async function exigirAdminTorneo(
  db: Db,
  actor: AuthUser,
  torneoId: string,
): Promise<Torneo> {
  const t = await cargarTorneo(db, torneoId);
  if (actor.rol !== "admin" || !(await esAdminActivo(db, torneoId, actor.id))) {
    throw Errors.forbidden("Solo los administradores de este torneo pueden hacer esto");
  }
  return t;
}

export function exigirEstado(
  t: Torneo,
  permitidos: readonly (typeof ESTADOS_TORNEO)[number][],
  accion: string,
) {
  if (!permitidos.includes(t.estado)) {
    throw Errors.conflict(`No se puede ${accion} con el torneo en estado "${t.estado}"`);
  }
}

export const vistaTorneo = (t: Torneo) => ({
  id: t.id,
  nombre: t.nombre,
  descripcion: t.descripcion,
  temporada: t.temporada,
  formato: t.formato,
  estado: t.estado,
  fechaInicio: t.fechaInicio,
  fechaFin: t.fechaFin,
  cupoMaximoEquipos: t.cupoMaximoEquipos,
  puntos: { victoria: t.puntosVictoria, empate: t.puntosEmpate, derrota: t.puntosDerrota },
  criteriosDesempate: t.criteriosDesempate,
});

export const evTorneo = (t: Torneo) => ({
  torneoId: t.id,
  nombre: t.nombre,
  estado: t.estado,
  formato: t.formato,
  version: t.version,
});
