import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import { Errors } from "./errors.js";

export type Rol = "admin" | "delegado";
export interface AuthUser {
  id: string;
  rol: Rol;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

const ISSUER = "gestor-auth";
const AUDIENCE = "gestor";
const key = (secret: string) => new TextEncoder().encode(secret);

/** Solo auth-service debería firmar tokens; todos los servicios los verifican. */
export async function signAccessToken(
  user: AuthUser,
  secret: string,
  ttlSeconds: number,
  now = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ rol: user.rol })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .setJti(randomUUID())
    .sign(key(secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
  now = new Date(),
): Promise<AuthUser> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
      currentDate: now,
    });
    if (typeof payload.sub !== "string") throw new Error("sin sub");
    if (payload.rol !== "admin" && payload.rol !== "delegado") throw new Error("rol inválido");
    return { id: payload.sub, rol: payload.rol };
  } catch {
    throw Errors.unauthorized("Sesión inválida o expirada");
  }
}

export function bearerToken(req: Pick<FastifyRequest, "headers">): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
}

/** preHandler: exige un token válido y deja el usuario en req.user. */
export function authenticate(secret: string, now: () => Date = () => new Date()) {
  return async (req: FastifyRequest) => {
    const token = bearerToken(req);
    if (!token) throw Errors.unauthorized();
    req.user = await verifyAccessToken(token, secret, now());
  };
}

/** preHandler: el rol se verifica en cada servicio, no solo en el gateway. */
export function requireRole(...roles: Rol[]) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw Errors.unauthorized();
    if (!roles.includes(req.user.rol)) throw Errors.forbidden();
  };
}
