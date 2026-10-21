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
    bodyLimit: 5 * 1024 * 1024,
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
  // Servicio de equipos falso: acepta cuerpos binarios (subida de imágenes).
  upstream.addContentTypeParser("multipart/form-data", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );
  upstream.get("/api/teams/equipos", async (req) => ({ auth: req.headers.authorization }));
  upstream.put("/api/teams/equipos/x/escudo", async (req) => ({
    bytes: (req.body as Buffer).length,
  }));
  upstream.get("/api/public/escudos/a.png", async () => ({ publico: true }));
  upstream.get("/api/public/equipos/e1", async () => ({ publico: true }));
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
    teamsUrl: url,
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
  it("enruta /api/teams con sesión y deja pasar escudos y equipos públicos sin sesión", async () => {
    const app = await gw();
    expect((await app.inject("/api/teams/equipos")).statusCode).toBe(401);
    const t = await token();
    const ok = await app.inject({
      url: "/api/teams/equipos",
      headers: { authorization: `Bearer ${t}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().auth).toBe(`Bearer ${t}`);
    expect((await app.inject("/api/public/escudos/a.png")).statusCode).toBe(200);
    expect((await app.inject("/api/public/equipos/e1")).statusCode).toBe(200);
  });
  it("deja pasar subidas de imágenes de 1,5 MB, pero no de más de 3 MB", async () => {
    const app = await gw();
    const t = await token();
    const enviar = (n: number) =>
      app.inject({
        method: "PUT",
        url: "/api/teams/equipos/x/escudo",
        payload: Buffer.alloc(n, 1),
        headers: {
          authorization: `Bearer ${t}`,
          "content-type": "multipart/form-data; boundary=x",
        },
      });
    const ok = await enviar(1_500_000);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().bytes).toBe(1_500_000);
    expect((await enviar(3_500_000)).statusCode).toBe(413);
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
