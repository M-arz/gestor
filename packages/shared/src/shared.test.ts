import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLogger, createServiceApp, Errors, loadConfig } from "./index.js";

async function makeApp(checks?: Record<string, () => Promise<void>>) {
  const app = await createServiceApp({
    name: "test-service",
    logger: createLogger("test-service", "silent"),
    readinessChecks: checks,
  });
  app.get("/boom", async () => {
    throw new Error("secreto interno");
  });
  app.get("/prohibido", async () => {
    throw Errors.forbidden();
  });
  app.get("/zod", async () => z.object({ n: z.number() }).parse({ n: "x" }));
  return app;
}

describe("plantilla de servicio", () => {
  it("responde /health", async () => {
    const app = await makeApp();
    const res = await app.inject("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "test-service" });
  });

  it("devuelve el id de correlación recibido", async () => {
    const app = await makeApp();
    const res = await app.inject({ url: "/health", headers: { "x-correlation-id": "abc-123" } });
    expect(res.headers["x-correlation-id"]).toBe("abc-123");
  });

  it("usa el formato de error uniforme y no filtra detalles internos", async () => {
    const app = await makeApp();
    const res = await app.inject("/boom");
    expect(res.statusCode).toBe(500);
    const { error } = res.json();
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).not.toContain("secreto");
    expect(error.correlationId).toBeTruthy();
  });

  it("mapea AppError, ZodError y rutas inexistentes", async () => {
    const app = await makeApp();
    expect((await app.inject("/prohibido")).statusCode).toBe(403);
    const z400 = await app.inject("/zod");
    expect(z400.statusCode).toBe(400);
    expect(z400.json().error.code).toBe("VALIDATION_ERROR");
    const nf = await app.inject("/nada");
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error.code).toBe("NOT_FOUND");
  });

  it("/ready devuelve 503 si una dependencia falla", async () => {
    const app = await makeApp({
      db: async () => {},
      redis: async () => {
        throw new Error("caído");
      },
    });
    const res = await app.inject("/ready");
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual({ db: "ok", redis: "fail" });
  });

  it("incluye cabeceras de seguridad (helmet)", async () => {
    const app = await makeApp();
    const res = await app.inject("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("loadConfig", () => {
  it("falla si falta PORT", () => {
    expect(() => loadConfig({}, {})).toThrow(/PORT/);
  });
  it("lee valores válidos", () => {
    const c = loadConfig({}, { PORT: "3001", LOG_LEVEL: "debug" });
    expect(c.PORT).toBe(3001);
    expect(c.LOG_LEVEL).toBe("debug");
  });
});
