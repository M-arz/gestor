import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { verifyAccessToken } from "@gestor/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadAuthConfig } from "./config.js";
import * as schema from "./db/schema.js";
import type { Db } from "./db/types.js";
import { crearCodigoAdmin, minutosDeBloqueo } from "./services/auth.service.js";

const config = loadAuthConfig({
  PORT: "3001",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://x:y@localhost:5432/z",
  JWT_SECRET: "j".repeat(40),
  IP_HASH_SECRET: "i".repeat(20),
});

let clock = new Date("2026-10-20T12:00:00Z");
const avanzar = (ms: number) => (clock = new Date(clock.getTime() + ms));
const MIN = 60_000;
const DIA = 86_400_000;

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let n = 0;
const nuevoCorreo = () => `usuario${++n}@ejemplo.com`;
const PASS = "contrasena-segura-1";

beforeAll(async () => {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, {
    migrationsFolder: fileURLToPath(new URL("./db/migrations", import.meta.url)),
  });
  db = pg as unknown as Db;
  app = await buildApp({ db, config, now: () => clock });
}, 60_000);

const post = (url: string, payload?: unknown, cookie?: string) =>
  app.inject({
    method: "POST",
    url: `/api/auth${url}`,
    payload: payload as object,
    headers: cookie ? { cookie } : {},
  });

async function registrar(correo = nuevoCorreo(), contrasena = PASS) {
  const r = await post("/register", { correo, nombre: "Ana", contrasena, aceptaPolitica: true });
  expect(r.statusCode).toBe(201);
  return correo;
}
const refreshCookie = (res: { cookies: { name: string; value: string }[] }) => {
  const c = res.cookies.find((x) => x.name === "refresh_token");
  return c ? `refresh_token=${c.value}` : undefined;
};

describe("registro", () => {
  it("crea el delegado con Argon2id, consentimiento y evento en el outbox", async () => {
    const correo = await registrar();
    const [u] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.correo, correo));
    expect(u?.rol).toBe("delegado");
    expect(u?.contrasenaHash.startsWith("$argon2id$")).toBe(true);
    const cons = await db
      .select()
      .from(schema.consentimientos)
      .where(eq(schema.consentimientos.usuarioId, u!.id));
    expect(cons[0]?.versionPolitica).toBe("1.0");
    const ev = await db.select().from(schema.eventosSalida);
    expect(ev.some((e) => e.tipo === "usuario.registrado")).toBe(true);
  });
  it("rechaza correo repetido sin distinguir mayúsculas", async () => {
    const correo = await registrar();
    const r = await post("/register", {
      correo: correo.toUpperCase(),
      nombre: "B",
      contrasena: PASS,
      aceptaPolitica: true,
    });
    expect(r.statusCode).toBe(409);
  });
  it("rechaza contraseña corta y política no aceptada", async () => {
    const a = await post("/register", {
      correo: nuevoCorreo(),
      nombre: "A",
      contrasena: "corta",
      aceptaPolitica: true,
    });
    expect(a.statusCode).toBe(400);
    const b = await post("/register", {
      correo: nuevoCorreo(),
      nombre: "A",
      contrasena: PASS,
      aceptaPolitica: false,
    });
    expect(b.statusCode).toBe(400);
  });
  it("no se puede registrar como admin por la ruta pública", async () => {
    const correo = nuevoCorreo();
    await post("/register", {
      correo,
      nombre: "A",
      contrasena: PASS,
      aceptaPolitica: true,
      rol: "admin",
    });
    const [u] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.correo, correo));
    expect(u?.rol).toBe("delegado");
  });
});

describe("login y bloqueo", () => {
  it("entrega token verificable y cookie HttpOnly/Strict acotada a /api/auth", async () => {
    const correo = await registrar();
    const r = await post("/login", { correo, contrasena: PASS });
    expect(r.statusCode).toBe(200);
    const { accessToken, expiresIn } = r.json();
    expect(expiresIn).toBe(900);
    expect(await verifyAccessToken(accessToken, config.JWT_SECRET, clock)).toMatchObject({
      rol: "delegado",
    });
    const c = r.cookies.find((x) => x.name === "refresh_token");
    expect(c).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api/auth" });
    expect(JSON.stringify(r.json())).not.toContain("refresh");
  });
  it("da el mismo error para contraseña mala y correo inexistente", async () => {
    const correo = await registrar();
    const a = await post("/login", { correo, contrasena: "incorrecta-123" });
    const b = await post("/login", { correo: "nadie@ejemplo.com", contrasena: "incorrecta-123" });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
  });
  it("bloquea tras 5 fallos (aun con la contraseña correcta) y se libera con el tiempo", async () => {
    const correo = await registrar();
    for (let i = 0; i < 5; i++) await post("/login", { correo, contrasena: "mala-contrasena" });
    const bloqueado = await post("/login", { correo, contrasena: PASS });
    expect(bloqueado.statusCode).toBe(423);
    avanzar(2 * MIN);
    expect((await post("/login", { correo, contrasena: PASS })).statusCode).toBe(200);
  });
  it("el bloqueo crece: 1, 2, 4... hasta 60 minutos", () => {
    expect([4, 5, 6, 7, 20].map(minutosDeBloqueo)).toEqual([0, 1, 2, 4, 60]);
  });
});

describe("sesiones", () => {
  it("/me exige token y el token vence a los 15 minutos", async () => {
    const correo = await registrar();
    const { accessToken } = (await post("/login", { correo, contrasena: PASS })).json();
    const sin = await app.inject("/api/auth/me");
    expect(sin.statusCode).toBe(401);
    const ok = await app.inject({
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(ok.json().usuario.correo).toBe(correo);
    avanzar(16 * MIN);
    const vencido = await app.inject({
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(vencido.statusCode).toBe(401);
  });
  it("rota el refresh y revoca toda la familia si se reutiliza uno viejo", async () => {
    const correo = await registrar();
    const c1 = refreshCookie(await post("/login", { correo, contrasena: PASS }))!;
    const r2 = await post("/refresh", undefined, c1);
    expect(r2.statusCode).toBe(200);
    const c2 = refreshCookie(r2)!;
    expect(c2).not.toBe(c1);
    expect((await post("/refresh", undefined, c1)).statusCode).toBe(401); // reutilización
    expect((await post("/refresh", undefined, c2)).statusCode).toBe(401); // familia revocada
  });
  it("el refresh vence a los 7 días y sin cookie no entra", async () => {
    const correo = await registrar();
    const c = refreshCookie(await post("/login", { correo, contrasena: PASS }))!;
    expect((await post("/refresh")).statusCode).toBe(401);
    avanzar(8 * DIA);
    expect((await post("/refresh", undefined, c)).statusCode).toBe(401);
  });
  it("logout revoca la sesión", async () => {
    const correo = await registrar();
    const c = refreshCookie(await post("/login", { correo, contrasena: PASS }))!;
    expect((await post("/logout", undefined, c)).statusCode).toBe(204);
    expect((await post("/refresh", undefined, c)).statusCode).toBe(401);
  });
});

describe("recuperación de contraseña", () => {
  it("responde igual si la cuenta no existe y no genera evento", async () => {
    const antes = (await db.select().from(schema.eventosSalida)).length;
    const r = await post("/forgot-password", { correo: "fantasma@ejemplo.com" });
    expect(r.statusCode).toBe(202);
    expect((await db.select().from(schema.eventosSalida)).length).toBe(antes);
  });
  it("restablece una sola vez, cambia la clave y cierra las sesiones", async () => {
    const correo = await registrar();
    const c = refreshCookie(await post("/login", { correo, contrasena: PASS }))!;
    expect((await post("/forgot-password", { correo })).statusCode).toBe(202);
    const ev = (await db.select().from(schema.eventosSalida))
      .filter((e) => e.tipo === "usuario.recuperacion_solicitada")
      .at(-1);
    const token = (ev!.payload as { token: string }).token;
    const nueva = "otra-contrasena-nueva-9";
    expect((await post("/reset-password", { token, contrasena: nueva })).statusCode).toBe(204);
    expect((await post("/reset-password", { token, contrasena: nueva })).statusCode).toBe(400);
    expect((await post("/login", { correo, contrasena: PASS })).statusCode).toBe(401);
    expect((await post("/login", { correo, contrasena: nueva })).statusCode).toBe(200);
    expect((await post("/refresh", undefined, c)).statusCode).toBe(401);
  });
  it("el enlace vence a los 30 minutos", async () => {
    const correo = await registrar();
    await post("/forgot-password", { correo });
    const ev = (await db.select().from(schema.eventosSalida))
      .filter((e) => e.tipo === "usuario.recuperacion_solicitada")
      .at(-1);
    avanzar(31 * MIN);
    const r = await post("/reset-password", {
      token: (ev!.payload as { token: string }).token,
      contrasena: "contrasena-nueva-123",
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("cuentas de administrador", () => {
  const datos = (codigo: string, correo = nuevoCorreo()) => ({
    codigo,
    correo,
    nombre: "Admin",
    contrasena: PASS,
    aceptaPolitica: true,
  });

  it("se crean solo con un código de un solo uso", async () => {
    const { codigo } = await crearCodigoAdmin(db, { diasVigencia: 7 }, () => clock);
    const correo = nuevoCorreo();
    const r = await post("/register-admin", datos(codigo, correo));
    expect(r.statusCode).toBe(201);
    expect(r.json().usuario.rol).toBe("admin");
    expect((await post("/register-admin", datos(codigo))).statusCode).toBe(400); // ya usado
    const login = await post("/login", { correo, contrasena: PASS });
    expect(
      await verifyAccessToken(login.json().accessToken, config.JWT_SECRET, clock),
    ).toMatchObject({ rol: "admin" });
  });
  it("sin código válido no hay admin", async () => {
    expect((await post("/register-admin", datos("a".repeat(40)))).statusCode).toBe(400);
  });
  it("un código atado a un correo no sirve para otro", async () => {
    const { codigo } = await crearCodigoAdmin(
      db,
      { correoDestino: "elegido@ejemplo.com", diasVigencia: 7 },
      () => clock,
    );
    expect((await post("/register-admin", datos(codigo, "otro@ejemplo.com"))).statusCode).toBe(400);
    expect((await post("/register-admin", datos(codigo, "elegido@ejemplo.com"))).statusCode).toBe(
      201,
    );
  });
  it("vence, y se bloquea tras 5 intentos con secreto incorrecto", async () => {
    const vencido = await crearCodigoAdmin(db, { diasVigencia: 1 }, () => clock);
    const bueno = await crearCodigoAdmin(db, { diasVigencia: 7 }, () => clock);
    const [id] = bueno.codigo.split(".");
    for (let i = 0; i < 5; i++)
      await post("/register-admin", datos(`${id}.secreto-equivocado-${i}`));
    expect((await post("/register-admin", datos(bueno.codigo))).statusCode).toBe(400);
    avanzar(2 * DIA);
    expect((await post("/register-admin", datos(vencido.codigo))).statusCode).toBe(400);
  });
});

describe("operación", () => {
  it("/ready comprueba la base de datos", async () => {
    const r = await app.inject("/ready");
    expect(r.statusCode).toBe(200);
    expect(r.json().checks).toEqual({ db: "ok" });
  });
  it("deja auditoría de los fallos de login con la IP en hash", async () => {
    const correo = await registrar();
    await post("/login", { correo, contrasena: "mala-contrasena" });
    const filas = await db
      .select()
      .from(schema.auditoriaAuth)
      .where(eq(schema.auditoriaAuth.accion, "login_fallido"));
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.at(-1)?.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("publicación del outbox", () => {
  it("entrega los eventos pendientes al bus una sola vez", async () => {
    const { crearOutboxStore } = await import("./bus.js");
    const store = crearOutboxStore(db);
    const correo = await registrar();
    const publicados: { tipo: string; payload: unknown }[] = [];
    let n = 0;
    for (
      let k = await store.procesarLote(async (lote) => void publicados.push(...lote));
      k > 0;
      k = await store.procesarLote(async (lote) => void publicados.push(...lote))
    )
      n += k;
    expect(n).toBeGreaterThan(0);
    const reg = publicados.find(
      (e) => e.tipo === "usuario.registrado" && (e.payload as { correo: string }).correo === correo,
    );
    expect(reg?.payload).toMatchObject({ rol: "delegado", correo });
    expect(JSON.stringify(reg?.payload)).not.toContain("contrasena");
    expect(await store.procesarLote(async () => {})).toBe(0); // ya están marcados como publicados
  });
  it("si publicar falla, el evento queda pendiente", async () => {
    const { crearOutboxStore } = await import("./bus.js");
    const store = crearOutboxStore(db);
    while ((await store.procesarLote(async () => {})) > 0);
    await registrar();
    await expect(
      store.procesarLote(async () => {
        throw new Error("redis caído");
      }),
    ).rejects.toThrow();
    expect(await store.procesarLote(async () => {})).toBeGreaterThan(0);
  });
});
