import { randomBytes, randomUUID } from "node:crypto";
import { AppError, Errors, type AuthUser } from "@gestor/shared";
import { violacionUnica } from "../db/errores.js";
import type { Db } from "../db/types.js";
import { MAYORIA_DE_EDAD, type Posicion, type TipoDocumento } from "../dominio.js";
import {
  type Equipo,
  equiposRepo,
  eventosRepo,
  type Jugador,
  jugadoresRepo,
} from "../repositories/teams.repo.js";
import { type Cifrador, enmascarar } from "../security/documento.js";
import type { Almacenamiento } from "../storage/almacenamiento.js";
import { detectarImagen, MIME_POR_EXT } from "../storage/imagen.js";

export type Acceso = "dueno" | "admin" | "ninguno";

export interface NuevoJugador {
  nombres: string;
  apellidos: string;
  tipoDocumento: TipoDocumento;
  documento: string;
  fechaNacimiento: string; // YYYY-MM-DD
  dorsal: number;
  posicion: Posicion;
  autorizacionAcudiente?: boolean;
}
export type CambiosJugador = Partial<NuevoJugador>;

/** Menor de 18 años a la fecha indicada. */
export function esMenor(fechaNacimiento: string, hoy: Date): boolean {
  const [y, m, d] = fechaNacimiento.split("-").map(Number) as [number, number, number];
  let edad = hoy.getUTCFullYear() - y;
  const mes = hoy.getUTCMonth() + 1;
  if (mes < m || (mes === m && hoy.getUTCDate() < d)) edad--;
  return edad < MAYORIA_DE_EDAD;
}

const urlEscudo = (clave: string | null) =>
  clave ? `/api/public/escudos/${clave.split("/")[1]}` : null;
const urlFoto = (j: Jugador) => (j.fotoUrl ? `/api/teams/jugadores/${j.id}/foto` : null);

export interface TeamsDeps {
  db: Db;
  almacenamiento: Almacenamiento;
  cifrador: Cifrador;
  now?: () => Date;
}

export function createTeamsService({
  db,
  almacenamiento,
  cifrador,
  now = () => new Date(),
}: TeamsDeps) {
  // ---------- vistas (qué se devuelve a quién) ----------
  const vistaEquipo = (e: Equipo, acceso: Acceso) => ({
    id: e.id,
    nombre: e.nombre,
    municipio: e.municipio,
    escudoUrl: urlEscudo(e.escudoUrl),
    estado: e.estado,
    ...(acceso === "dueno" ? { delegadoId: e.delegadoId } : {}),
    esMio: acceso === "dueno",
  });

  const habilitado = (j: Jugador, hoy: Date) =>
    !(j.fechaNacimiento && esMenor(j.fechaNacimiento, hoy)) || j.autorizacionAcudiente;

  const vistaJugador = (j: Jugador, hoy: Date) => ({
    id: j.id,
    equipoId: j.equipoId,
    nombres: j.nombres,
    apellidos: j.apellidos,
    tipoDocumento: j.tipoDocumento,
    documentoEnmascarado: j.documentoCifrado
      ? enmascarar(cifrador.descifrar(j.documentoCifrado))
      : null,
    fechaNacimiento: j.fechaNacimiento,
    esMenor: j.fechaNacimiento ? esMenor(j.fechaNacimiento, hoy) : false,
    autorizacionAcudiente: j.autorizacionAcudiente,
    habilitado: habilitado(j, hoy),
    dorsal: j.dorsal,
    posicion: j.posicion,
    fotoUrl: urlFoto(j),
  });

  // Los eventos llevan lo mínimo: nunca el documento ni la fecha de nacimiento.
  const evEquipo = (e: Equipo) => ({
    equipoId: e.id,
    nombre: e.nombre,
    municipio: e.municipio,
    escudoUrl: urlEscudo(e.escudoUrl),
    delegadoId: e.delegadoId,
    estado: e.estado,
    version: e.version,
  });
  const evJugador = (j: Jugador, hoy: Date) => ({
    jugadorId: j.id,
    equipoId: j.equipoId,
    nombreCompleto: `${j.nombres} ${j.apellidos}`.trim(),
    dorsal: j.dorsal,
    posicion: j.posicion,
    documentoHash: j.documentoHash,
    habilitado: habilitado(j, hoy),
    version: j.version,
  });

  // ---------- permisos ----------
  async function acceso(actor: AuthUser, e: Equipo): Promise<Acceso> {
    if (actor.rol === "delegado" && e.delegadoId === actor.id) return "dueno";
    if (actor.rol === "admin" && (await equiposRepo.esAdminDeEquipo(db, actor.id, e.id)))
      return "admin";
    return "ninguno";
  }
  async function cargarEquipo(id: string) {
    const e = await equiposRepo.findById(db, id);
    if (!e) throw Errors.notFound("Equipo no encontrado");
    return e;
  }
  async function equipoComoDueno(actor: AuthUser, id: string) {
    const e = await cargarEquipo(id);
    if ((await acceso(actor, e)) !== "dueno")
      throw Errors.forbidden("Solo el delegado de este equipo puede hacer esto");
    return e;
  }
  async function equipoParaVerPlantilla(actor: AuthUser, id: string) {
    const e = await cargarEquipo(id);
    const a = await acceso(actor, e);
    if (a === "ninguno") throw Errors.forbidden("No tienes acceso a la plantilla de este equipo");
    return { e, a };
  }
  /** Jugador por id: si no existe o no tienes acceso, siempre 404 (no revela qué ids existen). */
  async function jugadorVisible(actor: AuthUser, id: string) {
    const j = await jugadoresRepo.findById(db, id);
    const e = j && (await equiposRepo.findById(db, j.equipoId));
    if (!j || !e) throw Errors.notFound("Jugador no encontrado");
    const a = await acceso(actor, e);
    if (a === "ninguno") throw Errors.notFound("Jugador no encontrado");
    return { j, e, a };
  }
  const soloDueno = (a: Acceso) => {
    if (a !== "dueno") throw Errors.forbidden("Solo el delegado de este equipo puede hacer esto");
  };

  function conflictoJugador(e: unknown): never {
    const c = violacionUnica(e);
    if (c?.includes("documento"))
      throw Errors.conflict("Ya hay un jugador con ese documento en este equipo");
    if (c?.includes("dorsal")) throw Errors.conflict("Ese dorsal ya está en uso en este equipo");
    throw e;
  }

  async function guardarImagen(carpeta: "escudos" | "fotos", datos: Buffer) {
    const tipo = detectarImagen(datos);
    if (!tipo) throw Errors.badRequest("El archivo debe ser una imagen PNG, JPG o WebP válida");
    const clave = `${carpeta}/${randomUUID()}.${tipo.ext}`;
    await almacenamiento.guardar(clave, datos);
    return clave;
  }
  const borrarSilencioso = (clave: string | null | undefined) =>
    clave ? almacenamiento.borrar(clave).catch(() => undefined) : Promise.resolve();

  return {
    // ================= EQUIPOS =================
    async crearEquipo(actor: AuthUser, input: { nombre: string; municipio: string }) {
      if (actor.rol !== "delegado") throw Errors.forbidden("Solo los delegados crean equipos");
      const t = now();
      const id = randomUUID();
      try {
        const e = await db.transaction(async (tx) => {
          const [row] = await equiposRepo.insert(tx, {
            id,
            nombre: input.nombre,
            municipio: input.municipio,
            delegadoId: actor.id,
            creadoEn: t,
            actualizadoEn: t,
          });
          await eventosRepo.outbox(tx, "equipo.creado", evEquipo(row!), t);
          await eventosRepo.auditoria(tx, {
            usuarioId: actor.id,
            equipoId: id,
            accion: "equipo_creado",
            ahora: t,
          });
          return row!;
        });
        return vistaEquipo(e, "dueno");
      } catch (e) {
        if (violacionUnica(e)) throw Errors.conflict("Ya tienes un equipo con ese nombre");
        throw e;
      }
    },

    async listarEquipos(actor: AuthUser) {
      if (actor.rol === "delegado") {
        return (await equiposRepo.listarDeDelegado(db, actor.id)).map((e) =>
          vistaEquipo(e, "dueno"),
        );
      }
      return (await equiposRepo.listarDeAdmin(db, actor.id)).map((e) => vistaEquipo(e, "admin"));
    },

    /** Datos básicos (nombre, municipio, escudo): los ve cualquier usuario con sesión. */
    async obtenerEquipo(actor: AuthUser, id: string) {
      const e = await cargarEquipo(id);
      return vistaEquipo(e, await acceso(actor, e));
    },

    async actualizarEquipo(
      actor: AuthUser,
      id: string,
      cambios: { nombre?: string; municipio?: string },
    ) {
      const actual = await equipoComoDueno(actor, id);
      const t = now();
      try {
        return vistaEquipo(
          await db.transaction(async (tx) => {
            const [row] = await equiposRepo.update(tx, id, { ...cambios, actualizadoEn: t });
            await eventosRepo.outbox(tx, "equipo.actualizado", evEquipo(row!), t);
            await eventosRepo.auditoria(tx, {
              usuarioId: actor.id,
              equipoId: actual.id,
              accion: "equipo_actualizado",
              ahora: t,
            });
            return row!;
          }),
          "dueno",
        );
      } catch (e) {
        if (violacionUnica(e)) throw Errors.conflict("Ya tienes un equipo con ese nombre");
        throw e;
      }
    },

    async eliminarEquipo(actor: AuthUser, id: string) {
      await equipoComoDueno(actor, id);
      const t = now();
      await db.transaction(async (tx) => {
        const [row] = await equiposRepo.update(tx, id, { eliminadoEn: t, actualizadoEn: t });
        await eventosRepo.outbox(
          tx,
          "equipo.eliminado",
          { equipoId: id, version: row!.version },
          t,
        );
        await eventosRepo.auditoria(tx, {
          usuarioId: actor.id,
          equipoId: id,
          accion: "equipo_eliminado",
          ahora: t,
        });
      });
    },

    async subirEscudo(actor: AuthUser, id: string, datos: Buffer) {
      const actual = await equipoComoDueno(actor, id);
      const clave = await guardarImagen("escudos", datos);
      const t = now();
      try {
        const e = await db.transaction(async (tx) => {
          const [row] = await equiposRepo.update(tx, id, { escudoUrl: clave, actualizadoEn: t });
          await eventosRepo.outbox(tx, "equipo.actualizado", evEquipo(row!), t);
          await eventosRepo.auditoria(tx, {
            usuarioId: actor.id,
            equipoId: id,
            accion: "escudo_actualizado",
            ahora: t,
          });
          return row!;
        });
        await borrarSilencioso(actual.escudoUrl);
        return vistaEquipo(e, "dueno");
      } catch (err) {
        await borrarSilencioso(clave);
        throw err;
      }
    },

    /** Público: solo nombre, municipio y escudo. */
    async equipoPublico(id: string) {
      const e = await cargarEquipo(id);
      return {
        id: e.id,
        nombre: e.nombre,
        municipio: e.municipio,
        escudoUrl: urlEscudo(e.escudoUrl),
      };
    },

    async leerEscudo(nombreArchivo: string) {
      const datos = await almacenamiento.leer(`escudos/${nombreArchivo}`);
      if (!datos) throw Errors.notFound("Archivo no encontrado");
      return {
        datos,
        mime: MIME_POR_EXT[nombreArchivo.split(".")[1] ?? ""] ?? "application/octet-stream",
      };
    },

    // ================= JUGADORES =================
    async listarJugadores(actor: AuthUser, equipoId: string) {
      const { e } = await equipoParaVerPlantilla(actor, equipoId);
      const hoy = now();
      return (await jugadoresRepo.listarDeEquipo(db, e.id)).map((j) => vistaJugador(j, hoy));
    },

    async agregarJugador(actor: AuthUser, equipoId: string, input: NuevoJugador) {
      const e = await equipoComoDueno(actor, equipoId);
      const t = now();
      const id = randomUUID();
      const autorizado = input.autorizacionAcudiente === true;
      try {
        const j = await db.transaction(async (tx) => {
          const [row] = await jugadoresRepo.insert(tx, {
            id,
            equipoId: e.id,
            nombres: input.nombres,
            apellidos: input.apellidos,
            tipoDocumento: input.tipoDocumento,
            documentoCifrado: cifrador.cifrar(
              input.documento.replace(/[\s.\-]/g, "").toUpperCase(),
            ),
            documentoHash: cifrador.hash(input.tipoDocumento, input.documento),
            fechaNacimiento: input.fechaNacimiento,
            dorsal: input.dorsal,
            posicion: input.posicion,
            autorizacionAcudiente: autorizado,
            autorizacionAcudienteEn: autorizado ? t : null,
            autorizacionRegistradaPor: autorizado ? actor.id : null,
            creadoEn: t,
            actualizadoEn: t,
          });
          await eventosRepo.outbox(tx, "jugador.agregado", evJugador(row!, t), t);
          await eventosRepo.auditoria(tx, {
            usuarioId: actor.id,
            equipoId: e.id,
            jugadorId: id,
            accion: "jugador_agregado",
            ahora: t,
          });
          return row!;
        });
        return vistaJugador(j, t);
      } catch (err) {
        return conflictoJugador(err);
      }
    },

    async actualizarJugador(actor: AuthUser, jugadorId: string, c: CambiosJugador) {
      const { j: actual, a } = await jugadorVisible(actor, jugadorId);
      soloDueno(a);
      const t = now();
      const patch: Partial<Jugador> = { actualizadoEn: t };
      if (c.nombres !== undefined) patch.nombres = c.nombres;
      if (c.apellidos !== undefined) patch.apellidos = c.apellidos;
      if (c.dorsal !== undefined) patch.dorsal = c.dorsal;
      if (c.posicion !== undefined) patch.posicion = c.posicion;
      if (c.fechaNacimiento !== undefined) patch.fechaNacimiento = c.fechaNacimiento;
      if (c.documento !== undefined && c.tipoDocumento !== undefined) {
        patch.tipoDocumento = c.tipoDocumento;
        patch.documentoCifrado = cifrador.cifrar(c.documento.replace(/[\s.\-]/g, "").toUpperCase());
        patch.documentoHash = cifrador.hash(c.tipoDocumento, c.documento);
      }
      if (
        c.autorizacionAcudiente !== undefined &&
        c.autorizacionAcudiente !== actual.autorizacionAcudiente
      ) {
        patch.autorizacionAcudiente = c.autorizacionAcudiente;
        patch.autorizacionAcudienteEn = c.autorizacionAcudiente ? t : null;
        patch.autorizacionRegistradaPor = c.autorizacionAcudiente ? actor.id : null;
      }
      try {
        const j = await db.transaction(async (tx) => {
          const [row] = await jugadoresRepo.update(tx, jugadorId, patch);
          await eventosRepo.outbox(tx, "jugador.actualizado", evJugador(row!, t), t);
          await eventosRepo.auditoria(tx, {
            usuarioId: actor.id,
            equipoId: actual.equipoId,
            jugadorId,
            accion: "jugador_actualizado",
            ahora: t,
          });
          return row!;
        });
        return vistaJugador(j, t);
      } catch (err) {
        return conflictoJugador(err);
      }
    },

    async eliminarJugador(actor: AuthUser, jugadorId: string) {
      const { j, a } = await jugadorVisible(actor, jugadorId);
      soloDueno(a);
      const t = now();
      await db.transaction(async (tx) => {
        const [row] = await jugadoresRepo.update(tx, jugadorId, {
          eliminadoEn: t,
          actualizadoEn: t,
        });
        await eventosRepo.outbox(
          tx,
          "jugador.eliminado",
          { jugadorId, equipoId: j.equipoId, version: row!.version },
          t,
        );
        await eventosRepo.auditoria(tx, {
          usuarioId: actor.id,
          equipoId: j.equipoId,
          jugadorId,
          accion: "jugador_eliminado",
          ahora: t,
        });
      });
    },

    /** Derecho de supresión (Ley 1581): borra los datos personales y conserva el historial. */
    async anonimizarJugador(actor: AuthUser, jugadorId: string) {
      const { j, a } = await jugadorVisible(actor, jugadorId);
      soloDueno(a);
      const t = now();
      await db.transaction(async (tx) => {
        const [row] = await jugadoresRepo.update(tx, jugadorId, {
          nombres: "Jugador",
          apellidos: "anonimizado",
          documentoCifrado: "",
          documentoHash: randomBytes(32).toString("hex"), // no coincide con ningún documento real
          fechaNacimiento: null,
          fotoUrl: null,
          autorizacionAcudiente: false,
          autorizacionAcudienteEn: null,
          autorizacionRegistradaPor: null,
          eliminadoEn: t,
          actualizadoEn: t,
        });
        await eventosRepo.outbox(
          tx,
          "jugador.eliminado",
          {
            jugadorId,
            equipoId: j.equipoId,
            anonimizado: true,
            nombreCompleto: "Jugador anonimizado",
            version: row!.version,
          },
          t,
        );
        await eventosRepo.auditoria(tx, {
          usuarioId: actor.id,
          equipoId: j.equipoId,
          jugadorId,
          accion: "jugador_anonimizado",
          ahora: t,
        });
      });
      await borrarSilencioso(j.fotoUrl);
    },

    async subirFoto(actor: AuthUser, jugadorId: string, datos: Buffer) {
      const { j: actual, a } = await jugadorVisible(actor, jugadorId);
      soloDueno(a);
      const clave = await guardarImagen("fotos", datos);
      const t = now();
      try {
        const j = await db.transaction(async (tx) => {
          const [row] = await jugadoresRepo.update(tx, jugadorId, {
            fotoUrl: clave,
            actualizadoEn: t,
          });
          await eventosRepo.auditoria(tx, {
            usuarioId: actor.id,
            equipoId: actual.equipoId,
            jugadorId,
            accion: "foto_actualizada",
            ahora: t,
          });
          return row!;
        });
        await borrarSilencioso(actual.fotoUrl);
        return vistaJugador(j, t);
      } catch (err) {
        await borrarSilencioso(clave);
        throw err;
      }
    },

    async leerFoto(actor: AuthUser, jugadorId: string) {
      const { j } = await jugadorVisible(actor, jugadorId);
      const datos = j.fotoUrl ? await almacenamiento.leer(j.fotoUrl) : null;
      if (!datos || !j.fotoUrl) throw Errors.notFound("El jugador no tiene foto");
      return {
        datos,
        mime: MIME_POR_EXT[j.fotoUrl.split(".")[1] ?? ""] ?? "application/octet-stream",
      };
    },

    /** Datos del carnet digital. El documento sale enmascarado, nunca completo. */
    async carnet(actor: AuthUser, jugadorId: string) {
      const { j, e } = await jugadorVisible(actor, jugadorId);
      const hoy = now();
      const v = vistaJugador(j, hoy);
      return {
        jugador: {
          id: j.id,
          nombreCompleto: `${j.nombres} ${j.apellidos}`.trim(),
          dorsal: j.dorsal,
          posicion: j.posicion,
          documentoEnmascarado: v.documentoEnmascarado,
          fotoUrl: v.fotoUrl,
          habilitado: v.habilitado,
        },
        equipo: {
          id: e.id,
          nombre: e.nombre,
          municipio: e.municipio,
          escudoUrl: urlEscudo(e.escudoUrl),
        },
      };
    },

    // ================= EVENTOS ENTRANTES =================
    /** Idempotente: un evento repetido no se vuelve a aplicar. */
    async aplicarEvento(evento: { id: string; tipo: string; payload: unknown }): Promise<boolean> {
      const t = now();
      return db.transaction(async (tx) => {
        if (!(await eventosRepo.marcarProcesado(tx, evento.id))) return false;
        if (evento.tipo === "usuario.desactivado") {
          const usuarioId = (evento.payload as { usuarioId?: string }).usuarioId;
          if (!usuarioId) throw new AppError(400, "BAD_EVENT", "Evento sin usuarioId");
          for (const e of await equiposRepo.marcarSinDelegado(tx, usuarioId, t)) {
            await eventosRepo.outbox(tx, "equipo.actualizado", evEquipo(e), t);
          }
        }
        return true;
      });
    },
  };
}
export type TeamsService = ReturnType<typeof createTeamsService>;
