import { randomUUID } from "node:crypto";
import { type AuthUser, Errors } from "@gestor/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  copiaJugadores,
  eventosPartido,
  grupoEquipos,
  grupos,
  partidos,
  plantillasTorneo,
} from "../db/schema.js";
import type { TipoEvento } from "../dominio.js";
import { generarLiguilla } from "../logica/fixture.js";
import {
  bloquearTorneo,
  datosEquipos,
  eventosRepo,
  inscripcionesAceptadas,
} from "../repositories/matches.repo.js";
import type { Db } from "../db/types.js";
import { cargarTorneo, type Ctx, exigirAdminTorneo, exigirEstado } from "./contexto.js";
import { recalcularPosiciones } from "./posiciones.service.js";

type Partido = typeof partidos.$inferSelect;

export interface EventoEntrada {
  tipo: TipoEvento;
  jugadorId: string;
  minuto: number;
}
export interface ResultadoEntrada {
  golesLocal: number;
  golesVisitante: number;
  eventos: EventoEntrada[];
}

export function crearPartidosService({ db, now }: Ctx) {
  const evPartido = (p: Partido, eq: Map<string, { equipoId: string }>) => ({
    partidoId: p.id,
    torneoId: p.torneoId,
    grupoId: p.grupoId,
    fase: p.fase,
    jornada: p.jornada,
    fechaHora: p.fechaHora,
    cancha: p.cancha,
    inscripcionLocalId: p.inscripcionLocalId,
    inscripcionVisitanteId: p.inscripcionVisitanteId,
    equipoLocalId: eq.get(p.inscripcionLocalId)?.equipoId ?? null,
    equipoVisitanteId: eq.get(p.inscripcionVisitanteId)?.equipoId ?? null,
    version: p.version,
  });

  async function cargarPartido(id: string) {
    const [p] = await db.select().from(partidos).where(eq(partidos.id, id));
    if (!p) throw Errors.notFound("Partido no encontrado");
    return p;
  }

  async function vistaPartidos(filas: Partido[], conIds: boolean, q: Db = db) {
    const eq_ = await datosEquipos(q, [
      ...new Set(filas.flatMap((p) => [p.inscripcionLocalId, p.inscripcionVisitanteId])),
    ]);
    const gs = filas.some((p) => p.grupoId)
      ? await q
          .select()
          .from(grupos)
          .where(
            inArray(grupos.id, [...new Set(filas.flatMap((p) => (p.grupoId ? [p.grupoId] : [])))]),
          )
      : [];
    const eqv = (id: string) => ({
      ...(conIds ? { inscripcionId: id } : {}),
      nombre: eq_.get(id)?.nombre ?? "Equipo",
      escudoUrl: eq_.get(id)?.escudoUrl ?? null,
    });
    return filas.map((p) => ({
      id: p.id,
      fase: p.fase,
      jornada: p.jornada,
      grupo: gs.find((g) => g.id === p.grupoId)?.nombre ?? null,
      fechaHora: p.fechaHora,
      cancha: p.cancha,
      estado: p.estado,
      local: eqv(p.inscripcionLocalId),
      visitante: eqv(p.inscripcionVisitanteId),
      golesLocal: p.golesLocal,
      golesVisitante: p.golesVisitante,
    }));
  }

  return {
    // ================= CALENDARIO =================
    async generarFixture(
      actor: AuthUser,
      torneoId: string,
      op: { grupoId?: string; idaVuelta?: boolean },
    ) {
      const torneo = await exigirAdminTorneo(db, actor, torneoId);
      exigirEstado(torneo, ["inscripciones_abiertas", "en_juego"], "generar el calendario");
      const t = now();
      return db.transaction(async (tx) => {
        await bloquearTorneo(tx, torneoId);
        const acept = await inscripcionesAceptadas(tx, torneoId);
        const equipoDe = new Map(acept.map((i) => [i.id, { equipoId: i.equipoId }]));
        const ids = acept.map((i) => i.id);

        const ambitos: {
          grupoId: string | null;
          nombre: string;
          ids: string[];
          fase: "grupos" | "liguilla";
        }[] = [];
        if (torneo.formato === "liguilla") {
          ambitos.push({ grupoId: null, nombre: "la liguilla", ids, fase: "liguilla" });
        } else {
          const gs = await tx
            .select()
            .from(grupos)
            .where(eq(grupos.torneoId, torneoId))
            .orderBy(asc(grupos.orden));
          if (gs.length === 0)
            throw Errors.conflict("Crea los grupos antes de generar el calendario");
          const elegidos = op.grupoId ? gs.filter((g) => g.id === op.grupoId) : gs;
          if (op.grupoId && elegidos.length === 0)
            throw Errors.notFound("Grupo no encontrado en este torneo");
          const asign = await tx
            .select()
            .from(grupoEquipos)
            .where(
              inArray(
                grupoEquipos.grupoId,
                gs.map((g) => g.id),
              ),
            );
          for (const g of elegidos) {
            ambitos.push({
              grupoId: g.id,
              nombre: g.nombre,
              ids: ids.filter((id) =>
                asign.some((a) => a.grupoId === g.id && a.inscripcionId === id),
              ),
              fase: "grupos",
            });
          }
        }

        const nuevos: (typeof partidos.$inferInsert)[] = [];
        for (const a of ambitos) {
          if (a.ids.length < 2) continue;
          const existentes = await tx
            .select({ id: partidos.id })
            .from(partidos)
            .where(
              a.grupoId
                ? and(eq(partidos.torneoId, torneoId), eq(partidos.grupoId, a.grupoId))
                : and(eq(partidos.torneoId, torneoId), eq(partidos.fase, "liguilla")),
            )
            .limit(1);
          if (existentes.length)
            throw Errors.conflict(`Ya hay partidos generados para ${a.nombre}`);
          for (const c of generarLiguilla(a.ids, op.idaVuelta === true)) {
            nuevos.push({
              id: randomUUID(),
              torneoId,
              fase: a.fase,
              jornada: c.jornada,
              grupoId: a.grupoId,
              inscripcionLocalId: c.local,
              inscripcionVisitanteId: c.visitante,
              creadoEn: t,
              actualizadoEn: t,
            });
          }
        }
        if (nuevos.length === 0)
          throw Errors.conflict("No hay equipos suficientes para generar partidos");
        const filas = await tx.insert(partidos).values(nuevos).returning();
        for (const p of filas)
          await eventosRepo.outbox(tx, "partido.programado", evPartido(p, equipoDe), t);
        await eventosRepo.auditoria(tx, {
          torneoId,
          usuarioId: actor.id,
          accion: "calendario_generado",
          detalle: { partidos: filas.length },
          ahora: t,
        });
        return { generados: filas.length };
      });
    },

    async crearPartido(
      actor: AuthUser,
      torneoId: string,
      i: {
        inscripcionLocalId: string;
        inscripcionVisitanteId: string;
        jornada?: number;
        fase?: "grupos" | "liguilla" | "eliminatoria";
        grupoId?: string;
        fechaHora?: string;
        cancha?: string;
      },
    ) {
      const torneo = await exigirAdminTorneo(db, actor, torneoId);
      exigirEstado(torneo, ["inscripciones_abiertas", "en_juego"], "crear partidos");
      if (i.inscripcionLocalId === i.inscripcionVisitanteId)
        throw Errors.badRequest("Un equipo no puede jugar contra sí mismo");
      const t = now();
      return db.transaction(async (tx) => {
        const acept = await inscripcionesAceptadas(tx, torneoId);
        const equipoDe = new Map(acept.map((x) => [x.id, { equipoId: x.equipoId }]));
        if (!equipoDe.has(i.inscripcionLocalId) || !equipoDe.has(i.inscripcionVisitanteId)) {
          throw Errors.badRequest(
            "Los dos equipos deben tener inscripción aceptada en este torneo",
          );
        }
        if (i.grupoId) {
          const [g] = await tx
            .select()
            .from(grupos)
            .where(and(eq(grupos.id, i.grupoId), eq(grupos.torneoId, torneoId)));
          if (!g) throw Errors.notFound("Grupo no encontrado en este torneo");
        }
        const [p] = await tx
          .insert(partidos)
          .values({
            id: randomUUID(),
            torneoId,
            fase: i.fase ?? (torneo.formato === "liguilla" ? "liguilla" : "grupos"),
            jornada: i.jornada ?? null,
            grupoId: i.grupoId ?? null,
            inscripcionLocalId: i.inscripcionLocalId,
            inscripcionVisitanteId: i.inscripcionVisitanteId,
            fechaHora: i.fechaHora ? new Date(i.fechaHora) : null,
            cancha: i.cancha ?? null,
            creadoEn: t,
            actualizadoEn: t,
          })
          .returning();
        await eventosRepo.outbox(tx, "partido.programado", evPartido(p!, equipoDe), t);
        await eventosRepo.auditoria(tx, {
          torneoId,
          usuarioId: actor.id,
          accion: "partido_creado",
          detalle: { partidoId: p!.id },
          ahora: t,
        });
        return (await vistaPartidos([p!], true, tx))[0]!;
      });
    },

    async actualizarPartido(
      actor: AuthUser,
      partidoId: string,
      c: { fechaHora?: string | null; cancha?: string | null; jornada?: number | null },
    ) {
      const previo = await cargarPartido(partidoId);
      await exigirAdminTorneo(db, actor, previo.torneoId);
      if (previo.estado === "finalizado" || previo.estado === "cancelado") {
        throw Errors.conflict(`Un partido ${previo.estado} no se puede reprogramar`);
      }
      const t = now();
      return db.transaction(async (tx) => {
        const patch: Partial<typeof partidos.$inferInsert> = {
          actualizadoEn: t,
          version: previo.version + 1,
        };
        if (c.fechaHora !== undefined) patch.fechaHora = c.fechaHora ? new Date(c.fechaHora) : null;
        if (c.cancha !== undefined) patch.cancha = c.cancha;
        if (c.jornada !== undefined) patch.jornada = c.jornada;
        const [p] = await tx
          .update(partidos)
          .set(patch)
          .where(eq(partidos.id, partidoId))
          .returning();
        const acept = await inscripcionesAceptadas(tx, previo.torneoId);
        const eq_ = new Map(acept.map((x) => [x.id, { equipoId: x.equipoId }]));
        const cambioFecha =
          c.fechaHora !== undefined && previo.fechaHora?.getTime() !== p!.fechaHora?.getTime();
        if (cambioFecha || (c.cancha !== undefined && c.cancha !== previo.cancha)) {
          await eventosRepo.outbox(
            tx,
            previo.fechaHora ? "partido.reprogramado" : "partido.programado",
            evPartido(p!, eq_),
            t,
          );
        }
        await eventosRepo.auditoria(tx, {
          torneoId: previo.torneoId,
          usuarioId: actor.id,
          accion: "partido_actualizado",
          detalle: { partidoId },
          ahora: t,
        });
        return (await vistaPartidos([p!], true, tx))[0]!;
      });
    },

    async cancelarPartido(actor: AuthUser, partidoId: string, motivo?: string) {
      const previo = await cargarPartido(partidoId);
      await exigirAdminTorneo(db, actor, previo.torneoId);
      if (previo.estado === "finalizado")
        throw Errors.conflict("Un partido finalizado no se cancela; corrige su resultado");
      if (previo.estado === "cancelado") throw Errors.conflict("El partido ya está cancelado");
      const t = now();
      await db.transaction(async (tx) => {
        const [p] = await tx
          .update(partidos)
          .set({ estado: "cancelado", actualizadoEn: t, version: previo.version + 1 })
          .where(eq(partidos.id, partidoId))
          .returning();
        const acept = await inscripcionesAceptadas(tx, previo.torneoId);
        const eq_ = new Map(acept.map((x) => [x.id, { equipoId: x.equipoId }]));
        await eventosRepo.outbox(
          tx,
          "partido.cancelado",
          { ...evPartido(p!, eq_), motivo: motivo ?? null },
          t,
        );
        await eventosRepo.auditoria(tx, {
          torneoId: previo.torneoId,
          usuarioId: actor.id,
          accion: "partido_cancelado",
          detalle: { partidoId },
          ahora: t,
        });
      });
    },

    // ================= RESULTADOS =================
    /**
     * Guarda marcador y eventos y recalcula la tabla en LA MISMA transacción. Si el partido ya tenía
     * resultado, es una corrección (los eventos anteriores se reemplazan).
     */
    async registrarResultado(actor: AuthUser, partidoId: string, r: ResultadoEntrada) {
      const previo = await cargarPartido(partidoId);
      const torneo = await exigirAdminTorneo(db, actor, previo.torneoId);
      exigirEstado(torneo, ["en_juego"], "registrar resultados");
      if (previo.estado === "cancelado") throw Errors.conflict("El partido está cancelado");
      const t = now();

      return db.transaction(async (tx) => {
        await bloquearTorneo(tx, torneo.id);
        // Solo pueden figurar jugadores habilitados en la plantilla de uno de los dos equipos.
        const plantilla = await tx
          .select()
          .from(plantillasTorneo)
          .where(
            and(
              inArray(plantillasTorneo.inscripcionId, [
                previo.inscripcionLocalId,
                previo.inscripcionVisitanteId,
              ]),
              eq(plantillasTorneo.estado, "habilitado"),
            ),
          );
        const ladoDe = new Map(plantilla.map((p) => [p.jugadorId, p.inscripcionId]));

        let golesLocalEv = 0;
        let golesVisitaEv = 0;
        const amarillas = new Map<string, number>();
        const rojas = new Set<string>();
        for (const e of r.eventos) {
          const insc = ladoDe.get(e.jugadorId);
          if (!insc)
            throw Errors.badRequest(
              "Hay un jugador que no está habilitado en ninguno de los dos equipos",
            );
          const esLocal = insc === previo.inscripcionLocalId;
          // Un autogol suma al rival.
          if (e.tipo === "gol") {
            if (esLocal) golesLocalEv++;
            else golesVisitaEv++;
          }
          if (e.tipo === "autogol") {
            if (esLocal) golesVisitaEv++;
            else golesLocalEv++;
          }
          if (e.tipo === "amarilla")
            amarillas.set(e.jugadorId, (amarillas.get(e.jugadorId) ?? 0) + 1);
          if (e.tipo === "roja") {
            if (rojas.has(e.jugadorId))
              throw Errors.badRequest(
                "Un jugador no puede tener dos tarjetas rojas en el mismo partido",
              );
            rojas.add(e.jugadorId);
          }
        }
        if ([...amarillas.values()].some((n) => n > 2))
          throw Errors.badRequest("Un jugador no puede tener más de 2 amarillas en un partido");
        if (golesLocalEv > r.golesLocal || golesVisitaEv > r.golesVisitante) {
          throw Errors.badRequest("Los goles registrados superan el marcador");
        }

        await tx.delete(eventosPartido).where(eq(eventosPartido.partidoId, partidoId));
        const nuevos = r.eventos.map((e) => ({
          id: randomUUID(),
          partidoId,
          tipo: e.tipo,
          jugadorId: e.jugadorId,
          inscripcionId: ladoDe.get(e.jugadorId)!,
          minuto: e.minuto,
          registradoPor: actor.id,
          creadoEn: t,
        }));
        if (nuevos.length) await tx.insert(eventosPartido).values(nuevos);

        const [p] = await tx
          .update(partidos)
          .set({
            estado: "finalizado",
            golesLocal: r.golesLocal,
            golesVisitante: r.golesVisitante,
            registradoPor: actor.id,
            actualizadoEn: t,
            version: previo.version + 1,
          })
          .where(eq(partidos.id, partidoId))
          .returning();
        await recalcularPosiciones(tx, torneo, t);

        const acept = await inscripcionesAceptadas(tx, torneo.id);
        const eq_ = new Map(acept.map((x) => [x.id, { equipoId: x.equipoId }]));
        const correccion = previo.estado === "finalizado";
        await eventosRepo.outbox(
          tx,
          "resultado.registrado",
          {
            ...evPartido(p!, eq_),
            golesLocal: r.golesLocal,
            golesVisitante: r.golesVisitante,
            correccion,
          },
          t,
        );
        for (const e of nuevos) {
          const base = {
            eventoId: e.id,
            partidoId,
            torneoId: torneo.id,
            jugadorId: e.jugadorId,
            equipoId: eq_.get(e.inscripcionId)?.equipoId ?? null,
            minuto: e.minuto,
          };
          if (e.tipo === "amarilla" || e.tipo === "roja") {
            await eventosRepo.outbox(tx, "tarjeta.registrada", { ...base, tipo: e.tipo }, t);
          } else if (e.tipo === "gol" || e.tipo === "autogol") {
            await eventosRepo.outbox(
              tx,
              "gol.registrado",
              { ...base, autogol: e.tipo === "autogol" },
              t,
            );
          }
        }
        await eventosRepo.auditoria(tx, {
          torneoId: torneo.id,
          usuarioId: actor.id,
          accion: correccion ? "resultado_corregido" : "resultado_registrado",
          detalle: { partidoId, marcador: `${r.golesLocal}-${r.golesVisitante}` },
          ahora: t,
        });
        return (await vistaPartidos([p!], true, tx))[0]!;
      });
    },

    // ================= LECTURA =================
    /** Vista pública del calendario: sin datos personales. Un torneo en borrador no se muestra. */
    async listarPublico(
      torneoId: string,
      f: { grupoId?: string; jornada?: number; estado?: string },
    ) {
      const torneo = await cargarTorneo(db, torneoId);
      if (torneo.estado === "borrador") throw Errors.notFound("Torneo no encontrado");
      const filas = await db
        .select()
        .from(partidos)
        .where(eq(partidos.torneoId, torneoId))
        .orderBy(asc(partidos.jornada), asc(partidos.fechaHora), asc(partidos.creadoEn));
      const f2 = filas.filter(
        (p) =>
          (!f.grupoId || p.grupoId === f.grupoId) &&
          (f.jornada === undefined || p.jornada === f.jornada) &&
          (!f.estado || p.estado === f.estado),
      );
      return vistaPartidos(f2, false);
    },

    /** Detalle con eventos (goles, tarjetas). Requiere sesión. */
    async detalle(actor: AuthUser, partidoId: string) {
      const p = await cargarPartido(partidoId);
      const torneo = await cargarTorneo(db, p.torneoId);
      if (torneo.estado === "borrador") await exigirAdminTorneo(db, actor, torneo.id);
      const evs = await db
        .select()
        .from(eventosPartido)
        .where(eq(eventosPartido.partidoId, partidoId))
        .orderBy(asc(eventosPartido.minuto));
      const jug = evs.length
        ? await db
            .select()
            .from(copiaJugadores)
            .where(
              inArray(
                copiaJugadores.jugadorId,
                evs.map((e) => e.jugadorId),
              ),
            )
        : [];
      const eq_ = await datosEquipos(
        db,
        evs.map((e) => e.inscripcionId),
      );
      return {
        partido: (await vistaPartidos([p], true))[0]!,
        eventos: evs.map((e) => ({
          tipo: e.tipo,
          minuto: e.minuto,
          jugador: jug.find((j) => j.jugadorId === e.jugadorId)?.nombreCompleto ?? "Jugador",
          equipo: eq_.get(e.inscripcionId)?.nombre ?? "Equipo",
        })),
      };
    },
  };
}
export type PartidosService = ReturnType<typeof crearPartidosService>;
