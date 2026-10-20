import { describe, expect, it } from "vitest";
import {
  authenticate,
  createLogger,
  createServiceApp,
  loadConfig,
  requireRole,
  signAccessToken,
  verifyAccessToken,
} from "./index.js";

const SECRET = "x".repeat(40);

describe("tokens de acceso", () => {
  it("firma y verifica", async () => {
    const t = await signAccessToken({ id: "u1", rol: "admin" }, SECRET, 60);
    expect(await verifyAccessToken(t, SECRET)).toEqual({ id: "u1", rol: "admin" });
  });
  it("rechaza firma distinta, expirado y basura", async () => {
    const t = await signAccessToken({ id: "u1", rol: "delegado" }, SECRET, 60);
    await expect(verifyAccessToken(t, "y".repeat(40))).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      verifyAccessToken(t, SECRET, new Date(Date.now() + 120_000)),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(verifyAccessToken("abc.def.ghi", SECRET)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe("authenticate + requireRole", () => {
  it("delegado no entra a una ruta de admin", async () => {
    const app = await createServiceApp({ name: "t", logger: createLogger("t", "silent") });
    app.get(
      "/solo-admin",
      { preHandler: [authenticate(SECRET), requireRole("admin")] },
      async (req) => ({ id: req.user?.id }),
    );
    const del = await signAccessToken({ id: "d1", rol: "delegado" }, SECRET, 60);
    const adm = await signAccessToken({ id: "a1", rol: "admin" }, SECRET, 60);
    expect((await app.inject("/solo-admin")).statusCode).toBe(401);
    expect(
      (await app.inject({ url: "/solo-admin", headers: { authorization: `Bearer ${del}` } }))
        .statusCode,
    ).toBe(403);
    const ok = await app.inject({
      url: "/solo-admin",
      headers: { authorization: `Bearer ${adm}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id: "a1" });
  });
});

describe("loadConfig en producción", () => {
  it("rechaza secretos de desarrollo", () => {
    expect(() =>
      loadConfig({}, { PORT: "1", NODE_ENV: "production", JWT_SECRET: "dev-only-abc" }),
    ).toThrow(/desarrollo/);
  });
});
