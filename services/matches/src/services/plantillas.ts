import { randomUUID } from "node:crypto";
import { and, asc, eq, ne, or } from "drizzle-orm";
import { copiaJugadores, plantillasTorneo } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { eventosRepo } from "../repositories/matches.repo.js";

type Jugador = typeof copiaJugadores.$inferSelect;
type EstadoPlantilla = "habilitado" | "en_conflicto" | "sin_autorizacion" | "retirado";

/**
 * Cuando un documento queda libre en el torneo, el primer jugador que estaba en conflicto
 * con él (y que sigue siendo válido) pasa a habilitado.
 */
export async function reevaluarDocumento(tx: Db, torneoId: string, documentoHash: string) {
  const [ocupado] = await tx
    .select({ id: plantillasTorneo.id })
    .from(plantillasTorneo)
    .where(
      and(
        eq(plantillasTorneo.torneoId, torneoId),
        eq(plantillasTorneo.documentoHash, documentoHash),
        eq(plantillasTorneo.estado, "habilitado"),
      ),
    )
    .limit(1);
  if (ocupado) return;
  const candidatos = await tx
    .select({ id: plantillasTorneo.id, jugador: copiaJugadores })
    .from(plantillasTorneo)
    .innerJoin(copiaJugadores, eq(copiaJugadores.jugadorId, plantillasTorneo.jugadorId))
    .where(
      and(
        eq(plantillasTorneo.torneoId, torneoId),
        eq(plantillasTorneo.documentoHash, documentoHash),
        eq(plantillasTorneo.estado, "en_conflicto"),
      ),
    )
    .orderBy(asc(plantillasTorneo.creadoEn), asc(plantillasTorneo.id));
  const elegido = candidatos.find((c) => c.jugador.habilitado && !c.jugador.eliminado);
  if (elegido) {
    await tx
      .update(plantillasTorneo)
      .set({ estado: "habilitado" })
      .where(eq(plantillasTorneo.id, elegido.id));
  }
}

/**
 * Deja la plantilla del torneo coherente con el jugador. Debe llamarse con el torneo bloqueado:
 * el documento no puede estar habilitado dos veces en el mismo torneo; el segundo queda en conflicto.
 */
export async function resolverPlantilla(
  tx: Db,
  p: { torneoId: string; inscripcionId: string; equipoId: string },
  j: Jugador,
  ahora: Date,
) {
  const [existente] = await tx
    .select()
    .from(plantillasTorneo)
    .where(
      and(
        eq(plantillasTorneo.inscripcionId, p.inscripcionId),
        eq(plantillasTorneo.jugadorId, j.jugadorId),
      ),
    );

  let deseado: EstadoPlantilla;
  if (j.eliminado) deseado = "retirado";
  else if (!j.habilitado) deseado = "sin_autorizacion";
  else {
    const [choque] = await tx
      .select({ id: plantillasTorneo.id })
      .from(plantillasTorneo)
      .where(
        and(
          eq(plantillasTorneo.torneoId, p.torneoId),
          eq(plantillasTorneo.documentoHash, j.documentoHash),
          eq(plantillasTorneo.estado, "habilitado"),
          existente ? ne(plantillasTorneo.id, existente.id) : or(),
        ),
      )
      .limit(1);
    deseado = choque ? "en_conflicto" : "habilitado";
  }

  const avisarConflicto = () =>
    eventosRepo.outbox(
      tx,
      "jugador.en_conflicto",
      {
        torneoId: p.torneoId,
        inscripcionId: p.inscripcionId,
        equipoId: p.equipoId,
        jugadorId: j.jugadorId,
      },
      ahora,
    );

  if (!existente) {
    if (deseado === "retirado") return;
    await tx.insert(plantillasTorneo).values({
      id: randomUUID(),
      torneoId: p.torneoId,
      inscripcionId: p.inscripcionId,
      jugadorId: j.jugadorId,
      documentoHash: j.documentoHash,
      estado: deseado,
      creadoEn: ahora,
    });
    if (deseado === "en_conflicto") await avisarConflicto();
    return;
  }
  if (existente.estado === deseado && existente.documentoHash === j.documentoHash) return;
  await tx
    .update(plantillasTorneo)
    .set({ estado: deseado, documentoHash: j.documentoHash })
    .where(eq(plantillasTorneo.id, existente.id));
  if (deseado === "en_conflicto" && existente.estado !== "en_conflicto") await avisarConflicto();
  // Si este jugador ocupaba un documento y ya no, otro puede quedar habilitado.
  if (existente.estado === "habilitado")
    await reevaluarDocumento(tx, p.torneoId, existente.documentoHash);
}
