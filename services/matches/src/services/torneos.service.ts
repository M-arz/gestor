import { randomUUID } from "node:crypto";
import { type AuthUser, Errors } from "@gestor/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { violacionUnica } from "../db/errores.js";
import { administradoresTorneo, copiaUsuariosAdmin, inscripciones, torneos } from "../db/schema.js";
import {
  CRITERIOS_POR_DEFECTO,
  ESTADOS_TORNEO,
  type EstadoTorneo,
  TRANSICIONES,
} from "../dominio.js";
import {
  adminsActivos,
  bloquearTorneo,
  eventosRepo,
  torneosRepo,
} from "../repositories/matches.repo.js";
import { cargarTorneo, type Ctx, evTorneo, exigirAdminTorneo, vistaTorneo } from "./contexto.js";
import { recalcularPosiciones } from "./posiciones.service.js";

export interface NuevoTorneo {
  nombre: string;
  descripcion?: string;
  temporada: string;
  formato: "grupos" | "liguilla";
  fechaInicio?: string;
  fechaFin?: string;
  cupoMaximoEquipos?: number;
  puntos?: { victoria: number; empate: number; derrota: number };
  criteriosDesempate?: string[];
}
export type CambiosTorneo = Partial<Omit<NuevoTorneo, "formato">>;

export function crearTorneosService({ db, now }: Ctx) {
  return {
    async crear(actor: AuthUser, input: NuevoTorneo) {
      if (actor.rol !== "admin")
        throw Errors.forbidden("Solo las cuentas de administrador crean torneos");
      const t = now();
      const id = randomUUID();
      const torneo = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(torneos)
          .values({
            id,
            nombre: input.nombre,
            descripcion: input.descripcion ?? null,
            temporada: input.temporada,
            formato: input.formato,
            fechaInicio: input.fechaInicio ?? null,
            fechaFin: input.fechaFin ?? null,
            cupoMaximoEquipos: input.cupoMaximoEquipos ?? null,
            puntosVictoria: input.puntos?.victoria ?? 3,
            puntosEmpate: input.puntos?.empate ?? 1,
            puntosDerrota: input.puntos?.derrota ?? 0,
            criteriosDesempate: input.criteriosDesempate ?? CRITERIOS_POR_DEFECTO,
            creadoPor: actor.id,
            creadoEn: t,
            actualizadoEn: t,
          })
          .returning();
        // Quien crea el torneo queda como un administrador más, igual a los demás.
        await tx
          .insert(administradoresTorneo)
          .values({ torneoId: id, usuarioId: actor.id, agregadoPor: actor.id, agregadoEn: t });
        await eventosRepo.outbox(tx, "torneo.creado", evTorneo(row!), t);
        await eventosRepo.outbox(
          tx,
          "torneo.administrador_agregado",
          { torneoId: id, usuarioId: actor.id },
          t,
        );
        await eventosRepo.auditoria(tx, {
          torneoId: id,
          usuarioId: actor.id,
          accion: "torneo_creado",
          ahora: t,
        });
        return row!;
      });
      return vistaTorneo(torneo);
    },

    async listar(actor: AuthUser) {
      if (actor.rol === "admin") {
        const filas = await db
          .select({ t: torneos })
          .from(torneos)
          .innerJoin(
            administradoresTorneo,
            and(
              eq(administradoresTorneo.torneoId, torneos.id),
              eq(administradoresTorneo.usuarioId, actor.id),
              isNull(administradoresTorneo.retiradoEn),
            ),
          )
          .orderBy(desc(torneos.creadoEn));
        return filas.map((f) => vistaTorneo(f.t));
      }
      // El delegado solo ve torneos que admiten solicitud de inscripción; el resto
      // se consideran no elegibles para pedir plaza desde la app.
      const filas = await db
        .select()
        .from(torneos)
        .where(eq(torneos.estado, "inscripciones_abiertas"))
        .orderBy(desc(torneos.creadoEn));
      return filas.map(vistaTorneo);
    },

    async obtener(actor: AuthUser, id: string) {
      const t = await cargarTorneo(db, id);
      const admin =
        actor.rol === "admin" &&
        (await adminsActivos(db, id)).some((a) => a.usuarioId === actor.id);
      // Un torneo en borrador solo lo ven sus administradores.
      if (!admin && t.estado === "borrador") throw Errors.notFound("Torneo no encontrado");
      return { ...vistaTorneo(t), esAdministrador: admin };
    },

    async actualizar(actor: AuthUser, id: string, c: CambiosTorneo) {
      const actual = await exigirAdminTorneo(db, actor, id);
      if (actual.estado === "archivado")
        throw Errors.conflict("Un torneo archivado no se puede modificar");
      const ahora = now();
      return vistaTorneo(
        await db.transaction(async (tx) => {
          await bloquearTorneo(tx, id);
          if (c.cupoMaximoEquipos !== undefined) {
            const [{ n } = { n: 0 }] = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(inscripciones)
              .where(and(eq(inscripciones.torneoId, id), eq(inscripciones.estado, "aceptada")));
            if (c.cupoMaximoEquipos < n) {
              throw Errors.conflict(`Ya hay ${n} equipos aceptados: el cupo no puede ser menor`);
            }
          }
          const patch: Partial<typeof torneos.$inferInsert> = { actualizadoEn: ahora };
          if (c.nombre !== undefined) patch.nombre = c.nombre;
          if (c.descripcion !== undefined) patch.descripcion = c.descripcion;
          if (c.temporada !== undefined) patch.temporada = c.temporada;
          if (c.fechaInicio !== undefined) patch.fechaInicio = c.fechaInicio;
          if (c.fechaFin !== undefined) patch.fechaFin = c.fechaFin;
          if (c.cupoMaximoEquipos !== undefined) patch.cupoMaximoEquipos = c.cupoMaximoEquipos;
          if (c.puntos) {
            patch.puntosVictoria = c.puntos.victoria;
            patch.puntosEmpate = c.puntos.empate;
            patch.puntosDerrota = c.puntos.derrota;
          }
          if (c.criteriosDesempate) patch.criteriosDesempate = c.criteriosDesempate;
          const [row] = await torneosRepo.update(tx, id, patch);
          if (c.puntos || c.criteriosDesempate) await recalcularPosiciones(tx, row!, ahora);
          await eventosRepo.outbox(tx, "torneo.actualizado", evTorneo(row!), ahora);
          await eventosRepo.auditoria(tx, {
            torneoId: id,
            usuarioId: actor.id,
            accion: "torneo_actualizado",
            ahora,
          });
          return row!;
        }),
      );
    },

    async cambiarEstado(actor: AuthUser, id: string, destino: EstadoTorneo) {
      const actual = await exigirAdminTorneo(db, actor, id);
      if (!ESTADOS_TORNEO.includes(destino) || !TRANSICIONES[actual.estado].includes(destino)) {
        throw Errors.conflict(`No se puede pasar de "${actual.estado}" a "${destino}"`);
      }
      const ahora = now();
      return vistaTorneo(
        await db.transaction(async (tx) => {
          await bloquearTorneo(tx, id);
          if (destino === "en_juego") {
            const [{ n } = { n: 0 }] = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(inscripciones)
              .where(and(eq(inscripciones.torneoId, id), eq(inscripciones.estado, "aceptada")));
            if (n < 2)
              throw Errors.conflict(
                "Se necesitan al menos 2 equipos aceptados para iniciar el torneo",
              );
          }
          const [row] = await torneosRepo.update(tx, id, {
            estado: destino,
            actualizadoEn: ahora,
            ...(destino === "archivado" ? { archivadoEn: ahora } : {}),
          });
          if (destino === "en_juego") await recalcularPosiciones(tx, row!, ahora); // tabla inicial en ceros
          await eventosRepo.outbox(
            tx,
            destino === "archivado" ? "torneo.archivado" : "torneo.actualizado",
            evTorneo(row!),
            ahora,
          );
          await eventosRepo.auditoria(tx, {
            torneoId: id,
            usuarioId: actor.id,
            accion: "torneo_estado",
            detalle: { de: actual.estado, a: destino },
            ahora,
          });
          return row!;
        }),
      );
    },

    // ---------- administradores del torneo ----------
    async administradores(actor: AuthUser, id: string) {
      await exigirAdminTorneo(db, actor, id);
      return (await adminsActivos(db, id)).map((a) => ({
        usuarioId: a.usuarioId,
        correo: a.correo,
        nombre: a.nombre,
        agregadoEn: a.agregadoEn,
        soyYo: a.usuarioId === actor.id,
      }));
    },

    /** Se agrega por correo a alguien que YA tenga cuenta de administrador. */
    async agregarAdministrador(actor: AuthUser, id: string, correo: string) {
      await exigirAdminTorneo(db, actor, id);
      const ahora = now();
      const [cuenta] = await db
        .select()
        .from(copiaUsuariosAdmin)
        .where(
          and(
            sql`lower(${copiaUsuariosAdmin.correo}) = ${correo.toLowerCase()}`,
            eq(copiaUsuariosAdmin.activo, true),
          ),
        )
        .limit(1);
      if (!cuenta) {
        throw Errors.notFound(
          "No hay una cuenta de administrador con ese correo. Pídele un código de acceso al desarrollador.",
        );
      }
      try {
        await db.transaction(async (tx) => {
          await bloquearTorneo(tx, id);
          const [previo] = await tx
            .select()
            .from(administradoresTorneo)
            .where(
              and(
                eq(administradoresTorneo.torneoId, id),
                eq(administradoresTorneo.usuarioId, cuenta.usuarioId),
              ),
            );
          if (previo && !previo.retiradoEn)
            throw Errors.conflict("Esa persona ya es administradora de este torneo");
          if (previo) {
            await tx
              .update(administradoresTorneo)
              .set({ retiradoEn: null, agregadoPor: actor.id, agregadoEn: ahora })
              .where(
                and(
                  eq(administradoresTorneo.torneoId, id),
                  eq(administradoresTorneo.usuarioId, cuenta.usuarioId),
                ),
              );
          } else {
            await tx
              .insert(administradoresTorneo)
              .values({
                torneoId: id,
                usuarioId: cuenta.usuarioId,
                agregadoPor: actor.id,
                agregadoEn: ahora,
              });
          }
          await eventosRepo.outbox(
            tx,
            "torneo.administrador_agregado",
            { torneoId: id, usuarioId: cuenta.usuarioId },
            ahora,
          );
          await eventosRepo.auditoria(tx, {
            torneoId: id,
            usuarioId: actor.id,
            accion: "administrador_agregado",
            detalle: { usuarioId: cuenta.usuarioId },
            ahora,
          });
        });
      } catch (e) {
        if (violacionUnica(e))
          throw Errors.conflict("Esa persona ya es administradora de este torneo");
        throw e;
      }
      return { usuarioId: cuenta.usuarioId, correo: cuenta.correo, nombre: cuenta.nombre };
    },

    /** Un torneo siempre conserva al menos un administrador (se comprueba bajo bloqueo). */
    async retirarAdministrador(actor: AuthUser, id: string, usuarioId: string) {
      await exigirAdminTorneo(db, actor, id);
      const ahora = now();
      await db.transaction(async (tx) => {
        await bloquearTorneo(tx, id);
        const activos = await adminsActivos(tx, id);
        if (!activos.some((a) => a.usuarioId === usuarioId))
          throw Errors.notFound("Esa persona no es administradora de este torneo");
        if (activos.length <= 1) {
          throw Errors.conflict("Un torneo siempre debe conservar al menos un administrador");
        }
        await tx
          .update(administradoresTorneo)
          .set({ retiradoEn: ahora })
          .where(
            and(
              eq(administradoresTorneo.torneoId, id),
              eq(administradoresTorneo.usuarioId, usuarioId),
            ),
          );
        await eventosRepo.outbox(
          tx,
          "torneo.administrador_retirado",
          { torneoId: id, usuarioId },
          ahora,
        );
        await eventosRepo.auditoria(tx, {
          torneoId: id,
          usuarioId: actor.id,
          accion: "administrador_retirado",
          detalle: { usuarioId },
          ahora,
        });
      });
    },
  };
}
export type TorneosService = ReturnType<typeof crearTorneosService>;
