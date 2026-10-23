import { randomUUID } from "node:crypto";
import { type AuthUser, Errors } from "@gestor/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { violacionUnica } from "../db/errores.js";
import {
  copiaEquipos,
  copiaJugadores,
  grupoEquipos,
  grupos,
  inscripciones,
  partidos,
  plantillasTorneo,
  torneos,
} from "../db/schema.js";
import { or } from "drizzle-orm";
import {
  bloquearTorneo,
  datosEquipos,
  eventosRepo,
  esAdminActivo,
  type Inscripcion,
  inscripcionesAceptadas,
} from "../repositories/matches.repo.js";
import { type Ctx, exigirAdminTorneo, exigirEstado, cargarTorneo } from "./contexto.js";
import { recalcularPosiciones } from "./posiciones.service.js";
import { reevaluarDocumento, resolverPlantilla } from "./plantillas.js";

const evInscripcion = (i: Inscripcion) => ({
  inscripcionId: i.id,
  torneoId: i.torneoId,
  equipoId: i.equipoId,
  estado: i.estado,
  version: i.version,
});

export function crearInscripcionesService({ db, now }: Ctx) {
  async function tienePartidos(inscripcionId: string) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(partidos)
      .where(
        or(
          eq(partidos.inscripcionLocalId, inscripcionId),
          eq(partidos.inscripcionVisitanteId, inscripcionId),
        ),
      );
    return (r?.n ?? 0) > 0;
  }
  async function cargarInscripcion(id: string) {
    const [i] = await db.select().from(inscripciones).where(eq(inscripciones.id, id));
    if (!i) throw Errors.notFound("Inscripción no encontrada");
    return i;
  }

  return {
    /** El delegado pide inscribir SU equipo. Queda pendiente hasta que un administrador decida. */
    async solicitar(actor: AuthUser, torneoId: string, equipoId: string) {
      if (actor.rol !== "delegado") throw Errors.forbidden("Solo los delegados inscriben equipos");
      const torneo = await cargarTorneo(db, torneoId);
      if (torneo.estado !== "inscripciones_abiertas")
        throw Errors.conflict("Las inscripciones de este torneo no están abiertas");
      const [equipo] = await db
        .select()
        .from(copiaEquipos)
        .where(eq(copiaEquipos.equipoId, equipoId));
      if (!equipo) {
        throw Errors.conflict(
          "Aún no recibimos los datos de tu equipo. Intenta de nuevo en unos segundos.",
        );
      }
      if (equipo.eliminado || equipo.delegadoId !== actor.id) {
        throw Errors.forbidden("Solo el delegado de un equipo puede inscribirlo");
      }
      const t = now();
      try {
        const i = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(inscripciones)
            .values({ id: randomUUID(), torneoId, equipoId, solicitadaPor: actor.id, creadoEn: t })
            .returning();
          await eventosRepo.outbox(tx, "inscripcion.solicitada", evInscripcion(row!), t);
          await eventosRepo.auditoria(tx, {
            torneoId,
            usuarioId: actor.id,
            accion: "inscripcion_solicitada",
            detalle: { equipoId },
            ahora: t,
          });
          return row!;
        });
        return { id: i.id, torneoId, equipoId, estado: i.estado };
      } catch (e) {
        if (violacionUnica(e))
          throw Errors.conflict(
            "Este equipo ya tiene una inscripción pendiente o aceptada en el torneo",
          );
        throw e;
      }
    },

    async listarDelTorneo(actor: AuthUser, torneoId: string) {
      await exigirAdminTorneo(db, actor, torneoId);
      const filas = await db
        .select()
        .from(inscripciones)
        .where(eq(inscripciones.torneoId, torneoId))
        .orderBy(asc(inscripciones.creadoEn));
      const eq_ = await datosEquipos(
        db,
        filas.map((f) => f.id),
      );
      const gs = filas.length
        ? await db
            .select({ i: grupoEquipos.inscripcionId, g: grupos.nombre, gid: grupos.id })
            .from(grupoEquipos)
            .innerJoin(grupos, eq(grupos.id, grupoEquipos.grupoId))
            .where(
              inArray(
                grupoEquipos.inscripcionId,
                filas.map((f) => f.id),
              ),
            )
        : [];
      return filas.map((f) => ({
        id: f.id,
        equipoId: f.equipoId,
        equipo: eq_.get(f.id)?.nombre ?? "Equipo",
        estado: f.estado,
        motivoDecision: f.motivoDecision,
        grupoId: gs.find((g) => g.i === f.id)?.gid ?? null,
        grupo: gs.find((g) => g.i === f.id)?.g ?? null,
        solicitadaEn: f.creadoEn,
      }));
    },

    async misInscripciones(actor: AuthUser) {
      if (actor.rol !== "delegado") return [];
      const filas = await db
        .select({ i: inscripciones, torneo: torneos.nombre, equipo: copiaEquipos.nombre })
        .from(inscripciones)
        .innerJoin(copiaEquipos, eq(copiaEquipos.equipoId, inscripciones.equipoId))
        .innerJoin(torneos, eq(torneos.id, inscripciones.torneoId))
        .where(eq(copiaEquipos.delegadoId, actor.id))
        .orderBy(desc(inscripciones.creadoEn));
      return filas.map((f) => ({
        id: f.i.id,
        torneoId: f.i.torneoId,
        torneo: f.torneo,
        equipoId: f.i.equipoId,
        equipo: f.equipo,
        estado: f.i.estado,
        motivoDecision: f.i.motivoDecision,
      }));
    },

    async aceptar(actor: AuthUser, inscripcionId: string) {
      const previa = await cargarInscripcion(inscripcionId);
      const torneo = await exigirAdminTorneo(db, actor, previa.torneoId);
      exigirEstado(torneo, ["inscripciones_abiertas"], "aceptar inscripciones");
      const t = now();
      return db.transaction(async (tx) => {
        await bloquearTorneo(tx, torneo.id);
        const [i] = await tx
          .select()
          .from(inscripciones)
          .where(eq(inscripciones.id, inscripcionId));
        if (!i || i.estado !== "pendiente")
          throw Errors.conflict("Esta inscripción ya fue decidida");
        if (torneo.cupoMaximoEquipos !== null) {
          const [{ n } = { n: 0 }] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(inscripciones)
            .where(
              and(eq(inscripciones.torneoId, torneo.id), eq(inscripciones.estado, "aceptada")),
            );
          if (n >= torneo.cupoMaximoEquipos)
            throw Errors.conflict("El torneo ya alcanzó su cupo de equipos");
        }
        const [eq_] = await tx
          .select()
          .from(copiaEquipos)
          .where(eq(copiaEquipos.equipoId, i.equipoId));
        if (!eq_ || eq_.eliminado) throw Errors.conflict("El equipo ya no existe");
        const [row] = await tx
          .update(inscripciones)
          .set({
            estado: "aceptada",
            decididaPor: actor.id,
            decididaEn: t,
            version: sql`${inscripciones.version} + 1`,
          })
          .where(eq(inscripciones.id, inscripcionId))
          .returning();
        // La plantilla del torneo se arma con los jugadores del equipo; el documento no puede repetirse.
        const plantilla = await tx
          .select()
          .from(copiaJugadores)
          .where(and(eq(copiaJugadores.equipoId, i.equipoId), eq(copiaJugadores.eliminado, false)));
        for (const j of plantilla) {
          await resolverPlantilla(
            tx,
            { torneoId: torneo.id, inscripcionId, equipoId: i.equipoId },
            j,
            t,
          );
        }
        await eventosRepo.outbox(tx, "inscripcion.aceptada", evInscripcion(row!), t);
        await eventosRepo.auditoria(tx, {
          torneoId: torneo.id,
          usuarioId: actor.id,
          accion: "inscripcion_aceptada",
          detalle: { inscripcionId },
          ahora: t,
        });
        return { id: row!.id, estado: row!.estado };
      });
    },

    async rechazar(actor: AuthUser, inscripcionId: string, motivo: string) {
      const previa = await cargarInscripcion(inscripcionId);
      const torneo = await exigirAdminTorneo(db, actor, previa.torneoId);
      const t = now();
      return db.transaction(async (tx) => {
        await bloquearTorneo(tx, torneo.id);
        const [i] = await tx
          .select()
          .from(inscripciones)
          .where(eq(inscripciones.id, inscripcionId));
        if (!i || i.estado !== "pendiente")
          throw Errors.conflict("Esta inscripción ya fue decidida");
        const [row] = await tx
          .update(inscripciones)
          .set({
            estado: "rechazada",
            motivoDecision: motivo,
            decididaPor: actor.id,
            decididaEn: t,
            version: sql`${inscripciones.version} + 1`,
          })
          .where(eq(inscripciones.id, inscripcionId))
          .returning();
        await eventosRepo.outbox(
          tx,
          "inscripcion.rechazada",
          { ...evInscripcion(row!), motivo },
          t,
        );
        await eventosRepo.auditoria(tx, {
          torneoId: torneo.id,
          usuarioId: actor.id,
          accion: "inscripcion_rechazada",
          detalle: { inscripcionId },
          ahora: t,
        });
        return { id: row!.id, estado: row!.estado };
      });
    },

    /** La retira el delegado del equipo o un administrador del torneo. Con partidos creados no se puede. */
    async retirar(actor: AuthUser, inscripcionId: string) {
      const previa = await cargarInscripcion(inscripcionId);
      const torneo = await cargarTorneo(db, previa.torneoId);
      const [equipo] = await db
        .select()
        .from(copiaEquipos)
        .where(eq(copiaEquipos.equipoId, previa.equipoId));
      const esDelegado = actor.rol === "delegado" && equipo?.delegadoId === actor.id;
      const esAdmin = actor.rol === "admin" && (await esAdminActivo(db, torneo.id, actor.id));
      if (!esDelegado && !esAdmin) throw Errors.forbidden("No puedes retirar esta inscripción");
      if (await tienePartidos(inscripcionId)) {
        throw Errors.conflict(
          "El equipo ya tiene partidos en el torneo. Cancélalos antes de retirarlo.",
        );
      }
      const t = now();
      return db.transaction(async (tx) => {
        await bloquearTorneo(tx, torneo.id);
        const [i] = await tx
          .select()
          .from(inscripciones)
          .where(eq(inscripciones.id, inscripcionId));
        if (!i || !["pendiente", "aceptada"].includes(i.estado))
          throw Errors.conflict("Esta inscripción ya no está activa");
        const [row] = await tx
          .update(inscripciones)
          .set({
            estado: "retirada",
            decididaPor: actor.id,
            decididaEn: t,
            version: sql`${inscripciones.version} + 1`,
          })
          .where(eq(inscripciones.id, inscripcionId))
          .returning();
        const habilitados = await tx
          .select()
          .from(plantillasTorneo)
          .where(
            and(
              eq(plantillasTorneo.inscripcionId, inscripcionId),
              eq(plantillasTorneo.estado, "habilitado"),
            ),
          );
        await tx
          .update(plantillasTorneo)
          .set({ estado: "retirado" })
          .where(eq(plantillasTorneo.inscripcionId, inscripcionId));
        for (const h of habilitados) await reevaluarDocumento(tx, torneo.id, h.documentoHash);
        await tx.delete(grupoEquipos).where(eq(grupoEquipos.inscripcionId, inscripcionId));
        await recalcularPosiciones(tx, torneo, t);
        await eventosRepo.outbox(tx, "inscripcion.retirada", evInscripcion(row!), t);
        await eventosRepo.auditoria(tx, {
          torneoId: torneo.id,
          usuarioId: actor.id,
          accion: "inscripcion_retirada",
          detalle: { inscripcionId },
          ahora: t,
        });
        return { id: row!.id, estado: row!.estado };
      });
    },

    /** Plantilla del torneo: la ve el administrador del torneo o el delegado del equipo. */
    async plantilla(actor: AuthUser, inscripcionId: string) {
      const i = await cargarInscripcion(inscripcionId);
      const [equipo] = await db
        .select()
        .from(copiaEquipos)
        .where(eq(copiaEquipos.equipoId, i.equipoId));
      const esDelegado = actor.rol === "delegado" && equipo?.delegadoId === actor.id;
      const esAdmin = actor.rol === "admin" && (await esAdminActivo(db, i.torneoId, actor.id));
      if (!esDelegado && !esAdmin) throw Errors.notFound("Inscripción no encontrada");
      const filas = await db
        .select({ p: plantillasTorneo, j: copiaJugadores })
        .from(plantillasTorneo)
        .leftJoin(copiaJugadores, eq(copiaJugadores.jugadorId, plantillasTorneo.jugadorId))
        .where(eq(plantillasTorneo.inscripcionId, inscripcionId))
        .orderBy(asc(copiaJugadores.dorsal));
      return filas.map((f) => ({
        jugadorId: f.p.jugadorId,
        nombre: f.j?.nombreCompleto ?? "Jugador",
        dorsal: f.j?.dorsal ?? null,
        posicion: f.j?.posicion ?? null,
        estado: f.p.estado,
      }));
    },

    // ================= GRUPOS =================
    async listarGrupos(actor: AuthUser, torneoId: string) {
      await exigirAdminTorneo(db, actor, torneoId);
      const gs = await db
        .select()
        .from(grupos)
        .where(eq(grupos.torneoId, torneoId))
        .orderBy(asc(grupos.orden));
      const asign = gs.length
        ? await db
            .select()
            .from(grupoEquipos)
            .where(
              inArray(
                grupoEquipos.grupoId,
                gs.map((g) => g.id),
              ),
            )
        : [];
      const eq_ = await datosEquipos(
        db,
        asign.map((a) => a.inscripcionId),
      );
      return gs.map((g) => ({
        id: g.id,
        nombre: g.nombre,
        equipos: asign
          .filter((a) => a.grupoId === g.id)
          .map((a) => ({
            inscripcionId: a.inscripcionId,
            nombre: eq_.get(a.inscripcionId)?.nombre ?? "Equipo",
          })),
      }));
    },

    async crearGrupo(actor: AuthUser, torneoId: string, nombre: string) {
      const torneo = await exigirAdminTorneo(db, actor, torneoId);
      if (torneo.formato !== "grupos")
        throw Errors.conflict("Este torneo es de liguilla: no usa grupos");
      exigirEstado(torneo, ["borrador", "inscripciones_abiertas", "en_juego"], "crear grupos");
      const t = now();
      try {
        return await db.transaction(async (tx) => {
          const [{ n } = { n: 0 }] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(grupos)
            .where(eq(grupos.torneoId, torneoId));
          const [g] = await tx
            .insert(grupos)
            .values({ id: randomUUID(), torneoId, nombre, orden: n + 1 })
            .returning();
          await eventosRepo.auditoria(tx, {
            torneoId,
            usuarioId: actor.id,
            accion: "grupo_creado",
            detalle: { nombre },
            ahora: t,
          });
          return { id: g!.id, nombre: g!.nombre };
        });
      } catch (e) {
        if (violacionUnica(e)) throw Errors.conflict("Ya existe un grupo con ese nombre");
        throw e;
      }
    },

    /** Crea N grupos (Grupo A, B...) y reparte los equipos aceptados en orden de inscripción. */
    async generarGrupos(actor: AuthUser, torneoId: string, cantidad: number) {
      const torneo = await exigirAdminTorneo(db, actor, torneoId);
      if (torneo.formato !== "grupos")
        throw Errors.conflict("Este torneo es de liguilla: no usa grupos");
      exigirEstado(torneo, ["inscripciones_abiertas", "en_juego"], "generar grupos");
      const t = now();
      return db.transaction(async (tx) => {
        await bloquearTorneo(tx, torneoId);
        const [{ n } = { n: 0 }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(grupos)
          .where(eq(grupos.torneoId, torneoId));
        if (n > 0) throw Errors.conflict("El torneo ya tiene grupos");
        const acept = await inscripcionesAceptadas(tx, torneoId);
        if (acept.length < cantidad * 2)
          throw Errors.conflict(
            `Se necesitan al menos ${cantidad * 2} equipos aceptados para ${cantidad} grupos`,
          );
        const nuevos = Array.from({ length: cantidad }, (_, k) => ({
          id: randomUUID(),
          torneoId,
          nombre: `Grupo ${String.fromCharCode(65 + k)}`,
          orden: k + 1,
        }));
        await tx.insert(grupos).values(nuevos);
        await tx
          .insert(grupoEquipos)
          .values(
            acept.map((i, k) => ({ grupoId: nuevos[k % cantidad]!.id, inscripcionId: i.id })),
          );
        await recalcularPosiciones(tx, torneo, t);
        await eventosRepo.auditoria(tx, {
          torneoId,
          usuarioId: actor.id,
          accion: "grupos_generados",
          detalle: { cantidad },
          ahora: t,
        });
        return nuevos.map((g) => ({
          id: g.id,
          nombre: g.nombre,
          equipos: acept.filter((_, k) => k % cantidad === g.orden - 1).length,
        }));
      });
    },

    /** Asigna (o quita, con null) un equipo a un grupo. No se mueve un equipo que ya tiene partidos. */
    async asignarGrupo(actor: AuthUser, inscripcionId: string, grupoId: string | null) {
      const i = await cargarInscripcion(inscripcionId);
      const torneo = await exigirAdminTorneo(db, actor, i.torneoId);
      if (i.estado !== "aceptada")
        throw Errors.conflict("Solo se asignan equipos con inscripción aceptada");
      if (await tienePartidos(inscripcionId))
        throw Errors.conflict("El equipo ya tiene partidos: no se puede cambiar de grupo");
      const t = now();
      await db.transaction(async (tx) => {
        await bloquearTorneo(tx, torneo.id);
        if (grupoId) {
          const [g] = await tx
            .select()
            .from(grupos)
            .where(and(eq(grupos.id, grupoId), eq(grupos.torneoId, torneo.id)));
          if (!g) throw Errors.notFound("Grupo no encontrado en este torneo");
        }
        await tx.delete(grupoEquipos).where(eq(grupoEquipos.inscripcionId, inscripcionId));
        if (grupoId) await tx.insert(grupoEquipos).values({ grupoId, inscripcionId });
        await recalcularPosiciones(tx, torneo, t);
        await eventosRepo.auditoria(tx, {
          torneoId: torneo.id,
          usuarioId: actor.id,
          accion: "equipo_asignado_grupo",
          detalle: { inscripcionId, grupoId },
          ahora: t,
        });
      });
    },
  };
}
export type InscripcionesService = ReturnType<typeof crearInscripcionesService>;
