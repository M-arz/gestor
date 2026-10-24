import { authenticate } from "@gestor/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthConfig } from "../config.js";
import type { AuthService, SesionEmitida } from "../services/auth.service.js";

const COOKIE = "refresh_token";
const correo = z.string().trim().toLowerCase().email().max(254);
const contrasena = z.string().min(10, "Mínimo 10 caracteres").max(128);
const nombre = z.string().trim().min(1).max(100);
const aceptaPolitica = z.literal(true, {
  errorMap: () => ({ message: "Debes aceptar la política" }),
});

const registro = z.object({ correo, nombre, contrasena, aceptaPolitica });
const registroAdmin = registro.extend({ codigo: z.string().min(10).max(200) });
const solicitudRegistroAdmin = registro;

const completarRegistroAdmin = z.object({
  solicitudId: z.string().uuid(),
  codigo: z.string().min(10).max(200),
});
const login = z.object({ correo, contrasena: z.string().min(1).max(128) });
const olvido = z.object({ correo });
const restablecer = z.object({ token: z.string().min(20).max(200), contrasena });

export function authRoutes(
  service: AuthService,
  config: AuthConfig,
  now: () => Date = () => new Date(),
) {
  const ctx = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });
  const cookieBase = {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/api/auth",
  };
  const ponerCookie = (reply: FastifyReply, s: SesionEmitida) =>
    reply.setCookie(COOKIE, s.refreshToken, { ...cookieBase, maxAge: s.refreshMaxAgeSeconds });
  const respuesta = (s: SesionEmitida) => ({
    accessToken: s.accessToken,
    expiresIn: s.expiresIn,
    usuario: s.usuario,
  });

  return async (app: FastifyInstance) => {
    app.addHook("onSend", async (_req, reply) => {
      reply.header("cache-control", "no-store");
    });

    app.post("/register", async (req, reply) => {
      const usuario = await service.registrarDelegado(registro.parse(req.body), ctx(req));
      return reply.status(201).send({ usuario });
    });

    app.post("/register-admin", async (req, reply) => {
      const usuario = await service.registrarAdmin(registroAdmin.parse(req.body), ctx(req));
      return reply.status(201).send({ usuario });
    });

    app.post("/register-admin/request", async (req, reply) => {
     const input = solicitudRegistroAdmin.parse(req.body);
     const resultado = await service.solicitarRegistroAdmin(input, ctx(req));
     return reply.status(201).send(resultado);
    });

    app.post("/register-admin/complete", async (req, reply) => {
      const input = completarRegistroAdmin.parse(req.body);

      const usuario = await service.completarRegistroAdmin(input, ctx(req));

      return reply.status(201).send({ usuario });
    });

    app.post("/login", async (req, reply) => {
      const s = await service.login(login.parse(req.body), ctx(req));
      ponerCookie(reply, s);
      return respuesta(s);
    });

    app.post("/refresh", async (req, reply) => {
      const token = req.cookies[COOKIE];
      if (!token) {
        return reply
          .status(401)
          .send({
            error: {
              code: "INVALID_SESSION",
              message: "Sesión inválida o expirada",
              correlationId: req.id,
            },
          });
      }
      try {
        const s = await service.refrescar(token, ctx(req));
        ponerCookie(reply, s);
        return respuesta(s);
      } catch (e) {
        reply.clearCookie(COOKIE, cookieBase);
        throw e;
      }
    });

    app.post("/logout", async (req, reply) => {
      await service.cerrarSesion(req.cookies[COOKIE], ctx(req));
      reply.clearCookie(COOKIE, cookieBase);
      return reply.status(204).send();
    });

    app.post("/forgot-password", async (req, reply) => {
      await service.solicitarRecuperacion(olvido.parse(req.body).correo, ctx(req));
      return reply
        .status(202)
        .send({ mensaje: "Si la cuenta existe, enviaremos un enlace al correo." });
    });

    app.post("/reset-password", async (req, reply) => {
      await service.restablecerContrasena(restablecer.parse(req.body), ctx(req));
      return reply.status(204).send();
    });

    app.get("/me", { preHandler: authenticate(config.JWT_SECRET, now) }, async (req) => ({
      usuario: await service.perfil(req.user!.id),
    }));
  };
}
