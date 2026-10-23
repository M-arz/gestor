import { and, eq, sql } from "drizzle-orm";
import {
  copiaEquipos,
  copiaJugadores,
  copiaUsuariosAdmin,
  eventosProcesados,
  inscripciones,
} from "../db/schema.js";
import { bloquearTorneo } from "../repositories/matches.repo.js";
import type { Db } from "../db/types.js";
import type { Ctx } from "./contexto.js";
import { resolverPlantilla } from "./plantillas.js";

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

export function crearEventosService({ db, now }: Ctx) {
  /** Un cambio en un jugador se refleja en sus plantillas de torneo (menor sin permiso, documento repetido...). */
  async function sincronizarJugador(tx: Db, jugadorId: string) {
    const [j] = await tx
      .select()
      .from(copiaJugadores)
      .where(eq(copiaJugadores.jugadorId, jugadorId));
    if (!j) return;
    const insc = await tx
      .select()
      .from(inscripciones)
      .where(and(eq(inscripciones.equipoId, j.equipoId), eq(inscripciones.estado, "aceptada")));
    // Se bloquea en orden para que dos eventos simultáneos no se crucen.
    for (const i of [...insc].sort((a, b) => a.torneoId.localeCompare(b.torneoId))) {
      await bloquearTorneo(tx, i.torneoId);
      await resolverPlantilla(
        tx,
        { torneoId: i.torneoId, inscripcionId: i.id, equipoId: i.equipoId },
        j,
        now(),
      );
    }
  }

  return {
    /**
     * Aplica un evento de otro servicio. Es idempotente (un evento repetido no se aplica dos veces)
     * y descarta los que llegan con una versión más vieja que la copia que ya se tiene.
     * Devuelve true si se aplicó (o se ignoró por vieja) y false si ya estaba procesado.
     */
    async aplicar(evento: { id: string; tipo: string; payload: unknown }): Promise<boolean> {
      const p = (evento.payload ?? {}) as Payload;
      return db.transaction(async (tx) => {
        const nuevo = await tx
          .insert(eventosProcesados)
          .values({ eventoId: evento.id })
          .onConflictDoNothing()
          .returning({ id: eventosProcesados.eventoId });
        if (nuevo.length === 0) return false;

        switch (evento.tipo) {
          case "usuario.registrado": {
            if (p.rol !== "admin") break; // solo se copian las cuentas que pueden ser administradoras
            const usuarioId = str(p.usuarioId);
            if (!usuarioId) break;
            await tx
              .insert(copiaUsuariosAdmin)
              .values({
                usuarioId,
                correo: str(p.correo) ?? "",
                nombre: str(p.nombre) ?? "",
                activo: true,
              })
              .onConflictDoUpdate({
                target: copiaUsuariosAdmin.usuarioId,
                set: { correo: str(p.correo) ?? "", nombre: str(p.nombre) ?? "" },
              });
            break;
          }
          case "usuario.correo_actualizado": {
            const usuarioId = str(p.usuarioId);
            if (usuarioId && str(p.correo)) {
              await tx
                .update(copiaUsuariosAdmin)
                .set({ correo: str(p.correo)! })
                .where(eq(copiaUsuariosAdmin.usuarioId, usuarioId));
            }
            break;
          }
          case "usuario.desactivado": {
            const usuarioId = str(p.usuarioId);
            if (usuarioId)
              await tx
                .update(copiaUsuariosAdmin)
                .set({ activo: false })
                .where(eq(copiaUsuariosAdmin.usuarioId, usuarioId));
            break;
          }
          case "equipo.creado":
          case "equipo.actualizado": {
            const equipoId = str(p.equipoId);
            const version = num(p.version) ?? 0;
            if (!equipoId || !str(p.delegadoId)) break;
            const [e] = await tx
              .select()
              .from(copiaEquipos)
              .where(eq(copiaEquipos.equipoId, equipoId));
            if (e && version <= e.version) break; // llegó fuera de orden
            const datos = {
              nombre: str(p.nombre) ?? "Equipo",
              municipio: str(p.municipio) ?? null,
              escudoUrl: str(p.escudoUrl) ?? null,
              delegadoId: str(p.delegadoId)!,
              version,
            };
            await tx
              .insert(copiaEquipos)
              .values({ equipoId, ...datos })
              .onConflictDoUpdate({ target: copiaEquipos.equipoId, set: datos });
            break;
          }
          case "equipo.eliminado": {
            const equipoId = str(p.equipoId);
            const version = num(p.version) ?? 0;
            if (!equipoId) break;
            await tx
              .update(copiaEquipos)
              .set({ eliminado: true, version })
              .where(
                and(eq(copiaEquipos.equipoId, equipoId), sql`${copiaEquipos.version} < ${version}`),
              );
            break;
          }
          case "jugador.agregado":
          case "jugador.actualizado": {
            const jugadorId = str(p.jugadorId);
            const equipoId = str(p.equipoId);
            const version = num(p.version) ?? 0;
            if (!jugadorId || !equipoId || !str(p.documentoHash)) break;
            const [j] = await tx
              .select()
              .from(copiaJugadores)
              .where(eq(copiaJugadores.jugadorId, jugadorId));
            if (j && version <= j.version) break;
            const datos = {
              equipoId,
              nombreCompleto: str(p.nombreCompleto) ?? "Jugador",
              dorsal: num(p.dorsal) ?? null,
              posicion: str(p.posicion) ?? null,
              documentoHash: str(p.documentoHash)!,
              habilitado: p.habilitado !== false,
              eliminado: false,
              version,
            };
            await tx
              .insert(copiaJugadores)
              .values({ jugadorId, ...datos })
              .onConflictDoUpdate({ target: copiaJugadores.jugadorId, set: datos });
            await sincronizarJugador(tx, jugadorId);
            break;
          }
          case "jugador.eliminado": {
            const jugadorId = str(p.jugadorId);
            const version = num(p.version) ?? 0;
            if (!jugadorId) break;
            const [j] = await tx
              .select()
              .from(copiaJugadores)
              .where(eq(copiaJugadores.jugadorId, jugadorId));
            if (!j || version <= j.version) break;
            await tx
              .update(copiaJugadores)
              .set({
                eliminado: true,
                version,
                ...(p.anonimizado === true ? { nombreCompleto: "Jugador anonimizado" } : {}),
              })
              .where(eq(copiaJugadores.jugadorId, jugadorId));
            await sincronizarJugador(tx, jugadorId);
            break;
          }
          default:
            break; // eventos que este servicio no usa
        }
        return true;
      });
    },
  };
}
export type EventosService = ReturnType<typeof crearEventosService>;
