import { Errors } from "@gestor/shared";
import { inArray } from "drizzle-orm";
import { torneos } from "../db/schema.js";
import { posicionesAExcel } from "../export/excel.js";
import { cargarTorneo, type Ctx } from "./contexto.js";
import { crearEventosService } from "./eventos.service.js";
import { crearInscripcionesService } from "./inscripciones.service.js";
import { crearPartidosService } from "./partidos.service.js";
import { estadisticasDelTorneo, tablasDelTorneo } from "./posiciones.service.js";
import { crearTorneosService } from "./torneos.service.js";
import { cargarTorneo as cargar } from "./contexto.js";
import type { AuthUser } from "@gestor/shared";
import { adminsActivos } from "../repositories/matches.repo.js";

export function crearMatchesService(ctx: Ctx) {
  const { db } = ctx;
  const partidos = crearPartidosService(ctx);
  /** Un torneo en borrador solo existe para sus administradores. */
  async function torneoVisible(id: string) {
    const t = await cargarTorneo(db, id);
    if (t.estado === "borrador") throw Errors.notFound("Torneo no encontrado");
    return t;
  }
  return {
    torneos: crearTorneosService(ctx),
    inscripciones: crearInscripcionesService(ctx),
    partidos,
    eventos: crearEventosService(ctx),

    /** Estadísticas: requieren sesión (incluyen nombres de jugadores). */
    async estadisticas(actor: AuthUser, torneoId: string) {
      const t = await cargar(db, torneoId);
      if (
        t.estado === "borrador" &&
        !(await adminsActivos(db, torneoId)).some((a) => a.usuarioId === actor.id)
      ) {
        throw Errors.notFound("Torneo no encontrado");
      }
      return estadisticasDelTorneo(db, torneoId);
    },

    // ---- vistas públicas: sin sesión, solo lectura, sin datos personales ----
    async torneosPublicos() {
      const filas = await db
        .select()
        .from(torneos)
        .where(inArray(torneos.estado, ["inscripciones_abiertas", "en_juego", "finalizado"]));
      return filas.map((t) => ({
        id: t.id,
        nombre: t.nombre,
        temporada: t.temporada,
        formato: t.formato,
        estado: t.estado,
      }));
    },
    async torneoPublico(id: string) {
      const t = await torneoVisible(id);
      return {
        id: t.id,
        nombre: t.nombre,
        descripcion: t.descripcion,
        temporada: t.temporada,
        formato: t.formato,
        estado: t.estado,
        fechaInicio: t.fechaInicio,
        fechaFin: t.fechaFin,
        puntos: { victoria: t.puntosVictoria, empate: t.puntosEmpate, derrota: t.puntosDerrota },
        criteriosDesempate: t.criteriosDesempate,
      };
    },
    async posicionesPublicas(id: string) {
      await torneoVisible(id);
      return tablasDelTorneo(db, id);
    },
    async listarPartidos(id: string, f: { grupoId?: string; jornada?: number; estado?: string }) {
      await torneoVisible(id);
      return partidos.listarPublico(id, f);
    },
    async posicionesExcel(id: string) {
      const t = await torneoVisible(id);
      return {
        nombre: `posiciones-${t.nombre.replace(/[^\w-]+/g, "_").slice(0, 40)}.xlsx`,
        datos: await posicionesAExcel(t.nombre, await tablasDelTorneo(db, id)),
      };
    },
  };
}
export type MatchesService = ReturnType<typeof crearMatchesService>;
