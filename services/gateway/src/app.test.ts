import { createLogger, createServiceApp, signAccessToken } from "@gestor/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const SECRET = "g".repeat(40);
let upstream: FastifyInstance;
let url: string;

beforeAll(async () => {
  // Servicio de auth falso: devuelve lo que recibe para poder inspeccionarlo.
  upstream = await createServiceApp({
    name: "auth-falso",
    logger: createLogger("falso", "silent"),
  });
  upstream.post("/api/auth/login", async (req, reply) => {
    reply.header("set-cookie", "refresh_token=abc; HttpOnly; Path=/api/auth; SameSite=Strict");
    return {
      body: req.body,
      xff: req.headers["x-forwarded-for"],
      corr: req.headers["x-correlation-id"],
    };
  });
  upstream.get("/api/auth/me", async (req) => ({ auth: req.headers.authorization }));
  await upstream.listen({ port: 0, host: "127.0.0.1" });
  const addr = upstream.server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => upstream.close());

const gw = (extra = {}) =>
  buildApp({
    logLevel: "silent",
    jwtSecret: SECRET,
    authUrl: url,
    corsOrigins: ["http://localhost:5173"],
    ...extra,
  });
const token = (rol: "admin" | "delegado" = "delegado") =>
  signAccessToken({ id: "u1", rol }, SECRET, 900);

describe("gateway", () => {
  it("deja pasar rutas públicas de auth y conserva la cookie del servicio", async () => {
    const app = await gw();
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { correo: "a@b.co" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().body).toEqual({ correo: "a@b.co" });
    expect(String(r.headers["set-cookie"])).toContain("HttpOnly");
  });
  it("reenvía la IP real y el id de correlación, ignorando lo que ponga el cliente", async () => {
    const app = await gw();
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
      headers: { "x-forwarded-for": "6.6.6.6", "x-correlation-id": "cid-1" },
    });
    expect(r.json().xff).not.toContain("6.6.6.6");
    expect(r.json().corr).toBeTruthy();
  });
  it("exige token en rutas protegidas y reenvía el Authorization si es válido", async () => {
    const app = await gw();
    expect((await app.inject("/api/auth/me")).statusCode).toBe(401);
    expect(
      (await app.inject({ url: "/api/auth/me", headers: { authorization: "Bearer basura" } }))
        .statusCode,
    ).toBe(401);
    const t = await token();
    const ok = await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${t}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().auth).toBe(`Bearer ${t}`);
  });
  it("rechaza un token vencido", async () => {
    const app = await gw({ now: () => new Date(Date.now() + 20 * 60_000) });
    const t = await token();
    expect(
      (await app.inject({ url: "/api/auth/me", headers: { authorization: `Bearer ${t}` } }))
        .statusCode,
    ).toBe(401);
  });
  it("rutas /api desconocidas sin sesión dan 401, no revelan cuáles existen", async () => {
    const app = await gw();
    expect((await app.inject("/api/teams/lo-que-sea")).statusCode).toBe(401);
  });
  it("limita por IP más estrictamente en login (429 con formato uniforme)", async () => {
    const app = await gw({ authLimitPerMin: 3 });
    const codigos: number[] = [];
    let ultimo;
    for (let i = 0; i < 5; i++) {
      ultimo = await app.inject({ method: "POST", url: "/api/auth/login", payload: {} });
      codigos.push(ultimo.statusCode);
    }
    expect(codigos).toEqual([200, 200, 200, 429, 429]);
    expect(ultimo?.json().error.code).toBe("TOO_MANY_REQUESTS");
  });
  it("aplica CORS solo a los orígenes permitidos y acepta credenciales", async () => {
    const app = await gw();
    const bueno = await app.inject({
      method: "OPTIONS",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
    });
    expect(bueno.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(bueno.headers["access-control-allow-credentials"]).toBe("true");
    const malo = await app.inject({
      method: "OPTIONS",
      url: "/api/auth/login",
      headers: { origin: "https://malo.com", "access-control-request-method": "POST" },
    });
    expect(malo.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("/health no pide sesión y lleva cabeceras de seguridad", async () => {
    const app = await gw();
    const r = await app.inject("/health");
    expect(r.statusCode).toBe(200);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
});
