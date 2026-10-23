import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  copiaJugadores,
  eventosPartido,
  grupoEquipos,
  grupos,
  inscripciones,
  partidos,
  posiciones,
} from "../db/schema.js";
import type { Db } from "../db/types.js";
import { type Criterio, FASES_QUE_PUNTUAN } from "../dominio.js";
import { ordenarTabla, type PartidoJugado } from "../logica/posiciones.js";
import { datosEquipos, inscripcionesAceptadas, type Torneo } from "../repositories/matches.repo.js";

/**
 * Recalcula toda la tabla del torneo desde los partidos finalizados. Se llama dentro de la
 * misma transacción que guarda un resultado, así la tabla nunca queda desactualizada.
 */
export async function recalcularPosiciones(tx: Db, torneo: Torneo, ahora: Date) {
  const aceptadas = await inscripcionesAceptadas(tx, torneo.id);
  const ids = aceptadas.map((i) => i.id);

  const jugados = (
    await tx
      .select()
      .from(partidos)
      .where(and(eq(partidos.torneoId, torneo.id), eq(partidos.estado, "finalizado")))
  )
    .filter((p) => FASES_QUE_PUNTUAN.includes(p.fase))
    .map((p): PartidoJugado => ({
      localId: p.inscripcionLocalId,
      visitanteId: p.inscripcionVisitanteId,
      golesLocal: p.golesLocal ?? 0,
      golesVisitante: p.golesVisitante ?? 0,
    }));

  // Qué equipos van en cada tabla: una sola (liguilla) o una por grupo (+ los que aún no tienen).
  const tablas: { grupoId: string | null; ids: string[] }[] = [];
  if (torneo.formato === "liguilla") {
    tablas.push({ grupoId: null, ids });
  } else {
    const gs = await tx
      .select()
      .from(grupos)
      .where(eq(grupos.torneoId, torneo.id))
      .orderBy(asc(grupos.orden));
    const asignados = ids.length
      ? await tx.select().from(grupoEquipos).where(inArray(grupoEquipos.inscripcionId, ids))
      : [];
    for (const g of gs) {
      tablas.push({
        grupoId: g.id,
        ids: ids.filter((id) =>
          asignados.some((a) => a.grupoId === g.id && a.inscripcionId === id),
        ),
      });
    }
    const sinGrupo = ids.filter((id) => !asignados.some((a) => a.inscripcionId === id));
    if (sinGrupo.length) tablas.push({ grupoId: null, ids: sinGrupo });
  }

  const reglas = {
    victoria: torneo.puntosVictoria,
    empate: torneo.puntosEmpate,
    derrota: torneo.puntosDerrota,
  };
  const filas = tablas.flatMap((t) =>
    ordenarTabla(t.ids, jugados, reglas, torneo.criteriosDesempate as Criterio[]).map((f) => ({
      torneoId: torneo.id,
      grupoId: t.grupoId,
      inscripcionId: f.inscripcionId,
      posicion: f.posicion,
      pj: f.pj,
      pg: f.pg,
      pe: f.pe,
      pp: f.pp,
      gf: f.gf,
      gc: f.gc,
      dg: f.dg,
      puntos: f.puntos,
      actualizadoEn: ahora,
    })),
  );
  await tx.delete(posiciones).where(eq(posiciones.torneoId, torneo.id));
  if (filas.length) await tx.insert(posiciones).values(filas);
}

export interface TablaVista {
  grupoId: string | null;
  grupo: string | null;
  filas: {
    posicion: number;
    inscripcionId: string;
    equipo: { nombre: string; escudoUrl: string | null };
    pj: number;
    pg: number;
    pe: number;
    pp: number;
    gf: number;
    gc: number;
    dg: number;
    puntos: number;
  }[];
}

/** Tabla lista para mostrar (pública): nombres y escudos, sin datos personales. */
export async function tablasDelTorneo(db: Db, torneoId: string): Promise<TablaVista[]> {
  const rows = await db
    .select({ p: posiciones, grupo: grupos.nombre, orden: grupos.orden })
    .from(posiciones)
    .leftJoin(grupos, eq(grupos.id, posiciones.grupoId))
    .where(eq(posiciones.torneoId, torneoId));
  const eq_ = await datosEquipos(
    db,
    rows.map((r) => r.p.inscripcionId),
  );
  const porGrupo = new Map<string, { orden: number; tabla: TablaVista }>();
  for (const r of rows) {
    const clave = r.p.grupoId ?? "sin-grupo";
    if (!porGrupo.has(clave)) {
      porGrupo.set(clave, {
        orden: r.orden ?? 9999,
        tabla: { grupoId: r.p.grupoId, grupo: r.grupo ?? null, filas: [] },
      });
    }
    const e = eq_.get(r.p.inscripcionId);
    porGrupo.get(clave)!.tabla.filas.push({
      posicion: r.p.posicion,
      inscripcionId: r.p.inscripcionId,
      equipo: { nombre: e?.nombre ?? "Equipo", escudoUrl: e?.escudoUrl ?? null },
      pj: r.p.pj,
      pg: r.p.pg,
      pe: r.p.pe,
      pp: r.p.pp,
      gf: r.p.gf,
      gc: r.p.gc,
      dg: r.p.dg,
      puntos: r.p.puntos,
    });
  }
  return [...porGrupo.values()]
    .sort((a, b) => a.orden - b.orden)
    .map((x) => ({ ...x.tabla, filas: x.tabla.filas.sort((a, b) => a.posicion - b.posicion) }));
}

/** Goleadores, asistentes y valla menos vencida (por equipo: no se registra qué portero jugó). */
export async function estadisticasDelTorneo(db: Db, torneoId: string) {
  const top = async (tipo: "gol" | "asistencia") => {
    const filas = await db
      .select({
        jugadorId: eventosPartido.jugadorId,
        inscripcionId: eventosPartido.inscripcionId,
        total: sql<number>`count(*)::int`,
      })
      .from(eventosPartido)
      .innerJoin(partidos, eq(partidos.id, eventosPartido.partidoId))
      .where(
        and(
          eq(partidos.torneoId, torneoId),
          eq(partidos.estado, "finalizado"),
          eq(eventosPartido.tipo, tipo),
        ),
      )
      .groupBy(eventosPartido.jugadorId, eventosPartido.inscripcionId)
      .orderBy(sql`count(*) desc`)
      .limit(20);
    const jug = filas.length
      ? await db
          .select()
          .from(copiaJugadores)
          .where(
            inArray(
              copiaJugadores.jugadorId,
              filas.map((f) => f.jugadorId),
            ),
          )
      : [];
    const eqs = await datosEquipos(
      db,
      filas.map((f) => f.inscripcionId),
    );
    return filas.map((f) => ({
      jugador: jug.find((j) => j.jugadorId === f.jugadorId)?.nombreCompleto ?? "Jugador",
      equipo: eqs.get(f.inscripcionId)?.nombre ?? "Equipo",
      total: f.total,
    }));
  };

  const filas = await db
    .select({ p: posiciones })
    .from(posiciones)
    .innerJoin(inscripciones, eq(inscripciones.id, posiciones.inscripcionId))
    .where(eq(posiciones.torneoId, torneoId));
  const eqs = await datosEquipos(
    db,
    filas.map((f) => f.p.inscripcionId),
  );
  const valla = filas
    .filter((f) => f.p.pj > 0)
    .map((f) => ({
      equipo: eqs.get(f.p.inscripcionId)?.nombre ?? "Equipo",
      pj: f.p.pj,
      golesContra: f.p.gc,
      promedio: Math.round((f.p.gc / f.p.pj) * 100) / 100,
    }))
    .sort((a, b) => a.promedio - b.promedio || b.pj - a.pj)
    .slice(0, 10);

  return {
    goleadores: await top("gol"),
    asistentes: await top("asistencia"),
    vallaMenosVencida: valla,
  };
}
