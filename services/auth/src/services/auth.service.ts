import { randomUUID } from "node:crypto";
import { AppError, Errors, signAccessToken } from "@gestor/shared";
import type { AuthConfig } from "../config.js";
import type { Db } from "../db/types.js";
import { eventosRepo } from "../repositories/eventos.repo.js";
import { codigosRepo, recuperacionesRepo, sesionesRepo } from "../repositories/tokens.repo.js";
import { solicitudesRepo } from "../repositories/solicitudes.repo.js";
import { type Usuario, usuariosRepo } from "../repositories/usuarios.repo.js";
import {
  hashIp,
  hashPassword,
  randomToken,
  safeEqualHex,
  sha256,
  verifyPassword,
} from "../security/crypto.js";

export interface Ctx {
  ip?: string;
  userAgent?: string;
}
export interface UsuarioPublico {
  id: string;
  correo: string;
  nombre: string;
  rol: "admin" | "delegado";
}
export interface SesionEmitida {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshMaxAgeSeconds: number;
  usuario: UsuarioPublico;
}

const MAX_INTENTOS_CODIGO = 5;
const UMBRAL_BLOQUEO = 5;
const VIDA_RECUPERACION_MIN = 30;

const publico = (u: Usuario): UsuarioPublico => ({
  id: u.id,
  correo: u.correo,
  nombre: u.nombre,
  rol: u.rol,
});
const credencialesInvalidas = () =>
  new AppError(401, "INVALID_CREDENTIALS", "Credenciales inválidas");
const sesionInvalida = () => new AppError(401, "INVALID_SESSION", "Sesión inválida o expirada");

function esViolacionUnica(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** Bloqueo progresivo: desde el 5.º fallo, 1, 2, 4, 8... minutos (máximo 60). */
export function minutosDeBloqueo(fallos: number): number {
  return fallos < UMBRAL_BLOQUEO ? 0 : Math.min(2 ** (fallos - UMBRAL_BLOQUEO), 60);
}

export interface AuthServiceDeps {
  db: Db;
  config: AuthConfig;
  now?: () => Date;
}

export function createAuthService({ db, config, now = () => new Date() }: AuthServiceDeps) {
  const ipHash = (ctx: Ctx) => hashIp(ctx.ip, config.IP_HASH_SECRET);
  const add = (d: Date, ms: number) => new Date(d.getTime() + ms);
  let dummyHash: Promise<string> | undefined;

  async function emitirSesion(
    tx: Db,
    u: Usuario,
    familiaId: string,
    ctx: Ctx,
    t: Date,
  ): Promise<SesionEmitida & { sesionId: string }> {
    const refreshToken = randomToken();
    const sesionId = randomUUID();
    const refreshMaxAgeSeconds = config.REFRESH_TTL_DAYS * 86_400;
    await sesionesRepo.insert(tx, {
      id: sesionId,
      usuarioId: u.id,
      tokenHash: sha256(refreshToken),
      familiaId,
      expiraEn: add(t, refreshMaxAgeSeconds * 1000),
      agenteUsuario: ctx.userAgent?.slice(0, 255) ?? null,
      ipHash: ipHash(ctx),
      creadoEn: t,
    });
    const expiresIn = config.ACCESS_TTL_MIN * 60;
    const accessToken = await signAccessToken(
      { id: u.id, rol: u.rol },
      config.JWT_SECRET,
      expiresIn,
      t,
    );
    return {
      accessToken,
      expiresIn,
      refreshToken,
      refreshMaxAgeSeconds,
      usuario: publico(u),
      sesionId,
    };
  }

  async function crearUsuario(
    rol: "admin" | "delegado",
    input: { correo: string; nombre: string; contrasena: string },
    ctx: Ctx,
    t: Date,
    extra?: (tx: Db, usuarioId: string) => Promise<void>,
    contrasenaHashExistente?: string
  ): Promise<UsuarioPublico> {
    const contrasenaHash = contrasenaHashExistente ?? (await hashPassword(input.contrasena));
    const id = randomUUID();
    try {
      await db.transaction(async (tx) => {
        await usuariosRepo.insert(tx, {
          id,
          correo: input.correo,
          nombre: input.nombre,
          contrasenaHash,
          rol,
          creadoEn: t,
          actualizadoEn: t,
        });
        await eventosRepo.consentimiento(tx, {
          usuarioId: id,
          version: config.POLICY_VERSION,
          ipHash: ipHash(ctx),
          ahora: t,
        });
        await eventosRepo.outbox(
          tx,
          "usuario.registrado",
          { usuarioId: id, correo: input.correo, nombre: input.nombre, rol },
          t,
        );
        await eventosRepo.auditoria(tx, {
          usuarioId: id,
          accion: rol === "admin" ? "registro_admin" : "registro",
          ipHash: ipHash(ctx),
          ahora: t,
        });
        if (extra) await extra(tx, id);
      });
    } catch (e) {
      if (esViolacionUnica(e)) throw Errors.conflict("Ya existe una cuenta con ese correo");
      throw e;
    }
    return { id, correo: input.correo, nombre: input.nombre, rol };
  }

  return {
    registrarDelegado: (input: { correo: string; nombre: string; contrasena: string }, ctx: Ctx) =>
      crearUsuario("delegado", input, ctx, now()),





async solicitarRegistroAdmin(
  input: {
    correo: string;
    nombre: string;
    contrasena: string;
    aceptaPolitica: true;
  },
  ctx: Ctx,
) {
  if (input.aceptaPolitica !== true) {
    throw new AppError(
      400,
      "POLICY_NOT_ACCEPTED",
      "Debes aceptar la política",
    );
  }

  const t = now();
  const correoNormalizado = input.correo.trim().toLowerCase();

  if (await usuariosRepo.findByCorreo(db, correoNormalizado)) {
    throw Errors.conflict("Ya existe una cuenta con ese correo");
  }

  const contrasenaHash = await hashPassword(input.contrasena);
  const id = randomUUID();
  const expiraEn = add(t, 24 * 60 * 60 * 1000);

  await solicitudesRepo.insert(db, {
    id,
    correo: correoNormalizado,
    nombre: input.nombre.trim(),
    contrasenaHash,
    versionPolitica: config.POLICY_VERSION,
    ipHash: ipHash(ctx),
    expiraEn,
    creadoEn: t,
  });

  await eventosRepo.auditoria(db, {
    accion: "solicitud_admin_creada",
    detalle: { solicitudId: id },
    ipHash: ipHash(ctx),
    ahora: t,
  });

  return {
    solicitudId: id,
    mensaje: "Solicitud guardada. Introduce tu código de acceso para continuar.",
    expiraEn,
  };
},


async completarRegistroAdmin(
  input: { solicitudId: string; codigo: string },
  ctx: Ctx,
): Promise<UsuarioPublico> {
  const t = now();
  const invalido = new AppError(
    400,
    "INVALID_ACCESS_CODE",
    "La solicitud o el código de acceso no son válidos o han vencido",
  );

  const solicitud = await solicitudesRepo.findById(db, input.solicitudId);

  if (
    !solicitud ||
    solicitud.completadaEn ||
    solicitud.expiraEn <= t
  ) {
    throw invalido;
  }

  const [codigoId, secreto] = input.codigo.split(".");

  if (!codigoId || !secreto || !/^[0-9a-f-]{36}$/i.test(codigoId)) {
    throw invalido;
  }

  const codigo = await codigosRepo.findById(db, codigoId);

  if (
    !codigo ||
    codigo.usadoEn ||
    codigo.expiraEn <= t ||
    codigo.intentosFallidos >= MAX_INTENTOS_CODIGO
  ) {
    throw invalido;
  }

  if (!safeEqualHex(sha256(secreto), codigo.codigoHash)) {
    await codigosRepo.sumarFallo(db, codigo.id, codigo.intentosFallidos);
    await eventosRepo.auditoria(db, {
      accion: "codigo_admin_fallido",
      detalle: { codigoId: codigo.id },
      ipHash: ipHash(ctx),
      ahora: t,
    });
    throw invalido;
  }

  if (
    codigo.correoDestino &&
    codigo.correoDestino.toLowerCase() !== solicitud.correo
  ) {
    throw invalido;
  }

  const usuarioId = randomUUID();

  try {
    await db.transaction(async (tx) => {
      // Evita completar una solicitud más de una vez.
      if (!(await solicitudesRepo.completar(tx, solicitud.id, t))) {
        throw invalido;
      }

      await usuariosRepo.insert(tx, {
        id: usuarioId,
        correo: solicitud.correo,
        nombre: solicitud.nombre,
        contrasenaHash: solicitud.contrasenaHash,
        rol: "admin",
        creadoEn: t,
        actualizadoEn: t,
      });

      await eventosRepo.consentimiento(tx, {
        usuarioId,
        version: solicitud.versionPolitica,
        ipHash: solicitud.ipHash,
        ahora: t,
      });

      await eventosRepo.outbox(
        tx,
        "usuario.registrado",
        {
          usuarioId,
          correo: solicitud.correo,
          nombre: solicitud.nombre,
          rol: "admin",
        },
        t,
      );

      if (!(await codigosRepo.consumir(tx, codigo.id, usuarioId, t))) {
        throw invalido;
      }

      await eventosRepo.auditoria(tx, {
        usuarioId,
        accion: "registro_admin",
        ipHash: ipHash(ctx),
        ahora: t,
      });

      await eventosRepo.auditoria(tx, {
        usuarioId,
        accion: "codigo_admin_usado",
        detalle: { codigoId: codigo.id },
        ipHash: ipHash(ctx),
        ahora: t,
      });
    });
  } catch (e) {
    if (esViolacionUnica(e)) {
      throw Errors.conflict("Ya existe una cuenta con ese correo");
    }
    throw e;
  }

  return {
    id: usuarioId,
    correo: solicitud.correo,
    nombre: solicitud.nombre,
    rol: "admin",
  };
},
    /** El código tiene la forma `<id>.<secreto>`; en la base solo está el hash del secreto. */
    async registrarAdmin(
      input: { codigo: string; correo: string; nombre: string; contrasena: string },
      ctx: Ctx,
    ) {
      const t = now();
      const invalido = new AppError(400, "INVALID_ACCESS_CODE", "Código de acceso inválido");
      const [codigoId, secreto] = input.codigo.split(".");
      if (!codigoId || !secreto || !/^[0-9a-f-]{36}$/i.test(codigoId)) throw invalido;
      const c = await codigosRepo.findById(db, codigoId);
      if (!c || c.usadoEn || c.expiraEn <= t || c.intentosFallidos >= MAX_INTENTOS_CODIGO) {
        throw invalido;
      }
      if (!safeEqualHex(sha256(secreto), c.codigoHash)) {
        await codigosRepo.sumarFallo(db, c.id, c.intentosFallidos);
        await eventosRepo.auditoria(db, {
          accion: "codigo_admin_fallido",
          detalle: { codigoId: c.id },
          ipHash: ipHash(ctx),
          ahora: t,
        });
        throw invalido;
      }
      if (c.correoDestino && c.correoDestino.toLowerCase() !== input.correo) throw invalido;
      return crearUsuario("admin", input, ctx, t, async (tx, usuarioId) => {
        const ok = await codigosRepo.consumir(tx, c.id, usuarioId, t);
        if (!ok) throw invalido; // alguien lo usó en paralelo: se deshace todo
        await eventosRepo.auditoria(tx, {
          usuarioId,
          accion: "codigo_admin_usado",
          detalle: { codigoId: c.id },
          ipHash: ipHash(ctx),
          ahora: t,
        });
      });
    },

    async login(input: { correo: string; contrasena: string }, ctx: Ctx): Promise<SesionEmitida> {
      const t = now();
      const u = await usuariosRepo.findByCorreo(db, input.correo);

      if (!u || u.estado !== "activo") {
        // Se hace el mismo trabajo de hash para no revelar por tiempo si la cuenta existe.
        dummyHash ??= hashPassword(randomToken());
        await verifyPassword(await dummyHash, input.contrasena);
        await eventosRepo.auditoria(db, {
          usuarioId: u?.id,
          accion: "login_fallido",
          detalle: { motivo: u ? "cuenta_no_activa" : "desconocido" },
          ipHash: ipHash(ctx),
          ahora: t,
        });
        throw credencialesInvalidas();
      }

      if (u.bloqueadoHasta && u.bloqueadoHasta > t) {
        await eventosRepo.auditoria(db, {
          usuarioId: u.id,
          accion: "login_bloqueado",
          ipHash: ipHash(ctx),
          ahora: t,
        });
        throw new AppError(
          423,
          "ACCOUNT_LOCKED",
          "Cuenta bloqueada temporalmente. Intenta más tarde.",
          {
            reintentarEnSegundos: Math.ceil((u.bloqueadoHasta.getTime() - t.getTime()) / 1000),
          },
        );
      }

      if (!(await verifyPassword(u.contrasenaHash, input.contrasena))) {
        const fallos = u.intentosFallidos + 1;
        const minutos = minutosDeBloqueo(fallos);
        await usuariosRepo.update(db, u.id, {
          intentosFallidos: fallos,
          bloqueadoHasta: minutos ? add(t, minutos * 60_000) : null,
          actualizadoEn: t,
        });
        await eventosRepo.auditoria(db, {
          usuarioId: u.id,
          accion: "login_fallido",
          detalle: { motivo: "contrasena", fallos, bloqueoMinutos: minutos },
          ipHash: ipHash(ctx),
          ahora: t,
        });
        throw credencialesInvalidas();
      }

      return db.transaction(async (tx) => {
        if (u.intentosFallidos > 0 || u.bloqueadoHasta) {
          await usuariosRepo.update(tx, u.id, {
            intentosFallidos: 0,
            bloqueadoHasta: null,
            actualizadoEn: t,
          });
        }
        const s = await emitirSesion(tx, u, randomUUID(), ctx, t);
        await eventosRepo.auditoria(tx, {
          usuarioId: u.id,
          accion: "login_ok",
          ipHash: ipHash(ctx),
          ahora: t,
        });
        return s;
      });
    },

    /** Refresh rotativo. Reutilizar un token ya usado revoca toda la familia. */
    async refrescar(token: string, ctx: Ctx): Promise<SesionEmitida> {
      const t = now();
      type R = { tipo: "ok"; s: SesionEmitida } | { tipo: "invalida" };
      const r = await db.transaction(async (tx): Promise<R> => {
        const s = await sesionesRepo.findByHash(tx, sha256(token));
        if (!s) return { tipo: "invalida" };

        const reutilizado = async (): Promise<R> => {
          await sesionesRepo.revocarFamilia(tx, s.familiaId, t);
          await eventosRepo.auditoria(tx, {
            usuarioId: s.usuarioId,
            accion: "refresh_reutilizado",
            ipHash: ipHash(ctx),
            ahora: t,
          });
          return { tipo: "invalida" };
        };

        if (s.revocadoEn) return reutilizado();
        if (s.expiraEn <= t) return { tipo: "invalida" };
        const u = await usuariosRepo.findById(tx, s.usuarioId);
        if (!u || u.estado !== "activo") {
          await sesionesRepo.revocarFamilia(tx, s.familiaId, t);
          return { tipo: "invalida" };
        }
        const nueva = await emitirSesion(tx, u, s.familiaId, ctx, t);
        // Si otra petición ya rotó este token, esta es una reutilización.
        if (!(await sesionesRepo.revocar(tx, s.id, t, nueva.sesionId))) return reutilizado();
        return { tipo: "ok", s: nueva };
      });
      if (r.tipo === "invalida") throw sesionInvalida();
      return r.s;
    },

    async cerrarSesion(token: string | undefined, ctx: Ctx): Promise<void> {
      if (!token) return;
      const t = now();
      const s = await sesionesRepo.findByHash(db, sha256(token));
      if (!s) return;
      await sesionesRepo.revocarFamilia(db, s.familiaId, t);
      await eventosRepo.auditoria(db, {
        usuarioId: s.usuarioId,
        accion: "logout",
        ipHash: ipHash(ctx),
        ahora: t,
      });
    },

    /** Responde igual exista o no la cuenta, para no revelar qué correos están registrados. */
    async solicitarRecuperacion(correo: string, ctx: Ctx): Promise<void> {
      const t = now();
      const u = await usuariosRepo.findByCorreo(db, correo);
      if (!u || u.estado !== "activo") return;
      const token = randomToken();
      const expiraEn = add(t, VIDA_RECUPERACION_MIN * 60_000);
      await db.transaction(async (tx) => {
        await recuperacionesRepo.insert(tx, {
          id: randomUUID(),
          usuarioId: u.id,
          tokenHash: sha256(token),
          expiraEn,
          creadoEn: t,
        });
        await eventosRepo.outbox(
          tx,
          "usuario.recuperacion_solicitada",
          { usuarioId: u.id, correo: u.correo, nombre: u.nombre, token, expiraEn },
          t,
        );
        await eventosRepo.auditoria(tx, {
          usuarioId: u.id,
          accion: "recuperacion_solicitada",
          ipHash: ipHash(ctx),
          ahora: t,
        });
      });
    },

    async restablecerContrasena(input: { token: string; contrasena: string }, ctx: Ctx) {
      const t = now();
      const invalido = new AppError(400, "INVALID_TOKEN", "El enlace no es válido o ya venció");
      const contrasenaHash = await hashPassword(input.contrasena);
      await db.transaction(async (tx) => {
        const rec = await recuperacionesRepo.findByHash(tx, sha256(input.token));
        if (!rec || rec.usadoEn || rec.expiraEn <= t) throw invalido;
        if (!(await recuperacionesRepo.marcarUsada(tx, rec.id, t))) throw invalido;
        await usuariosRepo.update(tx, rec.usuarioId, {
          contrasenaHash,
          intentosFallidos: 0,
          bloqueadoHasta: null,
          actualizadoEn: t,
        });
        await sesionesRepo.revocarDeUsuario(tx, rec.usuarioId, t);
        await eventosRepo.auditoria(tx, {
          usuarioId: rec.usuarioId,
          accion: "contrasena_restablecida",
          ipHash: ipHash(ctx),
          ahora: t,
        });
      });
    },

    async perfil(usuarioId: string): Promise<UsuarioPublico> {
      const u = await usuariosRepo.findById(db, usuarioId);
      if (!u || u.estado !== "activo") throw Errors.unauthorized();
      return publico(u);
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;

/** Lo usa el script del desarrollador. Devuelve el código en claro una sola vez. */
export async function crearCodigoAdmin(
  db: Db,
  opts: { correoDestino?: string; diasVigencia: number; creadoPor?: string },
  now: () => Date = () => new Date(),
): Promise<{ codigo: string; expiraEn: Date }> {
  const t = now();
  const id = randomUUID();
  const secreto = randomToken();
  const expiraEn = new Date(t.getTime() + opts.diasVigencia * 86_400_000);
  await codigosRepo.insert(db, {
    id,
    codigoHash: sha256(secreto),
    correoDestino: opts.correoDestino?.toLowerCase() ?? null,
    expiraEn,
    creadoPor: opts.creadoPor ?? "script",
    creadoEn: t,
  });
  await eventosRepo.auditoria(db, {
    accion: "codigo_admin_creado",
    detalle: { codigoId: id, correoDestino: opts.correoDestino ?? null },
    ipHash: null,
    ahora: t,
  });
  return { codigo: `${id}.${secreto}`, expiraEn };
}
