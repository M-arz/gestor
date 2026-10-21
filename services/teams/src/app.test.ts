import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { signAccessToken } from "@gestor/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { CLAVE_DOCUMENTO_DESARROLLO, loadTeamsConfig } from "./config.js";
import * as schema from "./db/schema.js";
import type { Db } from "./db/types.js";
import { AlmacenamientoMemoria } from "./storage/almacenamiento.js";

const SECRET = "j".repeat(40);
const config = loadTeamsConfig({
  PORT: "3002",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://x:y@localhost:5432/z",
  JWT_SECRET: SECRET,
  DOCUMENTO_CLAVE: CLAVE_DOCUMENTO_DESARROLLO,
  DOCUMENTO_HASH_CLAVE: "h".repeat(40),
  MAX_UPLOAD_BYTES: "100000",
});
const clock = new Date("2026-10-20T12:00:00Z");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const JPG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(30, 1),
  Buffer.from([0xff, 0xd9]),
]);

function multipart(contenido: Buffer, mime = "image/png", nombre = "x.png") {
  const b = "----limite";
  const cab = Buffer.from(
    `--${b}\r\nContent-Disposition: form-data; name="archivo"; filename="${nombre}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([cab, contenido, Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${b}` },
  };
}

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
const almacen = new AlmacenamientoMemoria();
const ids = { ana: randomUUID(), beto: randomUUID(), admin: randomUUID(), admin2: randomUUID() };
const tokens: Record<string, string> = {};
let n = 0;

beforeAll(async () => {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, {
    migrationsFolder: fileURLToPath(new URL("./db/migrations", import.meta.url)),
  });
  db = pg as unknown as Db;
  app = await buildApp({ db, config, almacenamiento: almacen, now: () => clock });
  tokens.ana = await signAccessToken({ id: ids.ana, rol: "delegado" }, SECRET, 900, clock);
  tokens.beto = await signAccessToken({ id: ids.beto, rol: "delegado" }, SECRET, 900, clock);
  tokens.admin = await signAccessToken({ id: ids.admin, rol: "admin" }, SECRET, 900, clock);
  tokens.admin2 = await signAccessToken({ id: ids.admin2, rol: "admin" }, SECRET, 900, clock);
}, 60_000);

const api = (
  method: string,
  url: string,
  quien?: string,
  payload?: unknown,
  extra: Record<string, string> = {},
) =>
  app.inject({
    method: method as "GET",
    url: `/api/teams${url}`,
    payload: payload as object,
    headers: { ...(quien ? { authorization: `Bearer ${tokens[quien]}` } : {}), ...extra },
  });

async function equipo(quien = "ana", nombre = `Equipo ${++n}`) {
  const r = await api("POST", "/equipos", quien, { nombre, municipio: "Montería" });
  expect(r.statusCode).toBe(201);
  return r.json().equipo as { id: string; escudoUrl: string | null };
}
const adulto = (o: object = {}) => ({
  nombres: "Luis",
  apellidos: "Pérez",
  tipoDocumento: "CC",
  documento: `${10_000_000 + ++n}`,
  fechaNacimiento: "1995-05-10",
  dorsal: 9,
  posicion: "delantero",
  ...o,
});
async function jugador(eqId: string, o: object = {}, quien = "ana") {
  const r = await api("POST", `/equipos/${eqId}/jugadores`, quien, adulto(o));
  expect(r.statusCode).toBe(201);
  return r.json().jugador as { id: string };
}
const outbox = async (tipo: string, clave: string, valor: string) =>
  (await db.select().from(schema.eventosSalida)).filter(
    (e) => e.tipo === tipo && (e.payload as Record<string, unknown>)[clave] === valor,
  );

describe("equipos y aislamiento entre delegados", () => {
  it("exige sesión", async () => {
    expect((await api("GET", "/equipos")).statusCode).toBe(401);
    expect(
      (await api("POST", "/equipos", undefined, { nombre: "X", municipio: "Y" })).statusCode,
    ).toBe(401);
  });
  it("el delegado crea su equipo y solo él lo ve en su lista", async () => {
    const e = await equipo("ana");
    const mios = (await api("GET", "/equipos", "ana")).json().equipos as { id: string }[];
    expect(mios.some((x) => x.id === e.id)).toBe(true);
    const deBeto = (await api("GET", "/equipos", "beto")).json().equipos as { id: string }[];
    expect(deBeto.some((x) => x.id === e.id)).toBe(false);
    const deAdmin = (await api("GET", "/equipos", "admin")).json().equipos as { id: string }[];
    expect(deAdmin.some((x) => x.id === e.id)).toBe(false);
  });
  it("un administrador no crea equipos", async () => {
    expect(
      (await api("POST", "/equipos", "admin", { nombre: "Admin FC", municipio: "Montería" }))
        .statusCode,
    ).toBe(403);
  });
  it("otro delegado no puede modificar, eliminar, ver la plantilla ni agregar jugadores", async () => {
    const e = await equipo("ana");
    expect((await api("PATCH", `/equipos/${e.id}`, "beto", { nombre: "Robado" })).statusCode).toBe(
      403,
    );
    expect((await api("DELETE", `/equipos/${e.id}`, "beto")).statusCode).toBe(403);
    expect((await api("GET", `/equipos/${e.id}/jugadores`, "beto")).statusCode).toBe(403);
    expect((await api("POST", `/equipos/${e.id}/jugadores`, "beto", adulto())).statusCode).toBe(
      403,
    );
    expect(
      (await api("PUT", `/equipos/${e.id}/escudo`, "beto", undefined, multipart(PNG).headers))
        .statusCode,
    ).not.toBe(200);
  });
  it("cualquiera con sesión ve los datos básicos, sin el id del delegado", async () => {
    const e = await equipo("ana");
    const r = (await api("GET", `/equipos/${e.id}`, "beto")).json().equipo;
    expect(r.nombre).toBeTruthy();
    expect(r.delegadoId).toBeUndefined();
    expect(r.esMio).toBe(false);
  });
  it("no repite nombre dentro del mismo delegado, pero otro delegado sí puede usarlo", async () => {
    await equipo("ana", "Los Leones");
    expect(
      (await api("POST", "/equipos", "ana", { nombre: "los leones", municipio: "Lorica" }))
        .statusCode,
    ).toBe(409);
    expect(
      (await api("POST", "/equipos", "beto", { nombre: "Los Leones", municipio: "Lorica" }))
        .statusCode,
    ).toBe(201);
  });
  it("valida la entrada", async () => {
    expect(
      (await api("POST", "/equipos", "ana", { nombre: "A", municipio: "Montería" })).statusCode,
    ).toBe(400);
    expect((await api("GET", "/equipos/no-es-uuid", "ana")).statusCode).toBe(400);
    expect((await api("GET", `/equipos/${randomUUID()}`, "ana")).statusCode).toBe(404);
  });
  it("eliminar es lógico: el equipo desaparece y avisa por evento", async () => {
    const e = await equipo("ana");
    await jugador(e.id);
    expect((await api("DELETE", `/equipos/${e.id}`, "ana")).statusCode).toBe(204);
    expect((await api("GET", `/equipos/${e.id}`, "ana")).statusCode).toBe(404);
    expect((await api("GET", `/equipos/${e.id}/jugadores`, "ana")).statusCode).toBe(404);
    expect((await outbox("equipo.eliminado", "equipoId", e.id)).length).toBe(1);
    const [fila] = await db.select().from(schema.equipos).where(eq(schema.equipos.id, e.id));
    expect(fila?.eliminadoEn).not.toBeNull();
  });
});

describe("jugadores y datos personales", () => {
  it("guarda el documento cifrado y nunca lo devuelve completo", async () => {
    const e = await equipo();
    const r = await api(
      "POST",
      `/equipos/${e.id}/jugadores`,
      "ana",
      adulto({ documento: "1.098.765.432" }),
    );
    const j = r.json().jugador;
    expect(j.documentoEnmascarado).toBe("*******432");
    expect(JSON.stringify(r.json())).not.toContain("1098765432");
    const [fila] = await db.select().from(schema.jugadores).where(eq(schema.jugadores.id, j.id));
    expect(fila?.documentoCifrado).not.toContain("1098765432");
    expect(fila?.documentoCifrado.startsWith("v1.")).toBe(true);
    expect(fila?.documentoHash).toMatch(/^[0-9a-f]{64}$/);
    const lista = await api("GET", `/equipos/${e.id}/jugadores`, "ana");
    expect(lista.body).not.toContain("1098765432");
    expect(lista.headers["cache-control"]).toBe("no-store");
  });
  it("rechaza documento y dorsal repetidos dentro del equipo", async () => {
    const e = await equipo();
    await jugador(e.id, { documento: "555.666.777", dorsal: 7 });
    const mismoDoc = await api(
      "POST",
      `/equipos/${e.id}/jugadores`,
      "ana",
      adulto({ documento: "555666777", dorsal: 8 }),
    );
    expect(mismoDoc.statusCode).toBe(409);
    expect(mismoDoc.json().error.message).toContain("documento");
    const mismoDorsal = await api(
      "POST",
      `/equipos/${e.id}/jugadores`,
      "ana",
      adulto({ dorsal: 7 }),
    );
    expect(mismoDorsal.statusCode).toBe(409);
    expect(mismoDorsal.json().error.message).toContain("dorsal");
  });
  it("el mismo dorsal y documento sí pueden estar en otro equipo (el torneo lo controla matches)", async () => {
    const a = await equipo("ana");
    const b = await equipo("ana");
    await jugador(a.id, { documento: "777888999", dorsal: 10 });
    await jugador(b.id, { documento: "777888999", dorsal: 10 });
  });
  it("liberar un dorsal al eliminar permite reutilizarlo", async () => {
    const e = await equipo();
    const j = await jugador(e.id, { dorsal: 3 });
    await api("DELETE", `/jugadores/${j.id}`, "ana");
    await jugador(e.id, { dorsal: 3 });
  });
  it("valida fecha, dorsal, tipo y posición", async () => {
    const e = await equipo();
    for (const mala of [
      { fechaNacimiento: "2030-01-01" },
      { fechaNacimiento: "1995-02-31" },
      { fechaNacimiento: "10/05/1995" },
      { dorsal: 100 },
      { dorsal: -1 },
      { tipoDocumento: "XX" },
      { posicion: "arbitro" },
      { documento: "12" },
    ]) {
      expect(
        (await api("POST", `/equipos/${e.id}/jugadores`, "ana", adulto(mala))).statusCode,
      ).toBe(400);
    }
  });
  it("ignora campos que el cliente no debería poder fijar", async () => {
    const e = await equipo();
    const r = await api("POST", `/equipos/${e.id}/jugadores`, "ana", {
      ...adulto(),
      equipoId: randomUUID(),
      version: 99,
      habilitado: false,
    });
    expect(r.statusCode).toBe(201);
    const [fila] = await db
      .select()
      .from(schema.jugadores)
      .where(eq(schema.jugadores.id, r.json().jugador.id));
    expect(fila?.equipoId).toBe(e.id);
    expect(fila?.version).toBe(1);
  });
  it("otro delegado recibe 404 al pedir un jugador ajeno (no se revela qué ids existen)", async () => {
    const e = await equipo("ana");
    const j = await jugador(e.id);
    expect((await api("PATCH", `/jugadores/${j.id}`, "beto", { dorsal: 50 })).statusCode).toBe(404);
    expect((await api("DELETE", `/jugadores/${j.id}`, "beto")).statusCode).toBe(404);
    expect((await api("GET", `/jugadores/${j.id}/carnet`, "beto")).statusCode).toBe(404);
    expect((await api("POST", `/jugadores/${j.id}/anonimizar`, "beto")).statusCode).toBe(404);
  });
  it("cambiar el documento requiere tipo y número juntos y actualiza el hash", async () => {
    const e = await equipo();
    const j = await jugador(e.id, { documento: "111222333" });
    expect(
      (await api("PATCH", `/jugadores/${j.id}`, "ana", { documento: "999888777" })).statusCode,
    ).toBe(400);
    const [antes] = await db.select().from(schema.jugadores).where(eq(schema.jugadores.id, j.id));
    const r = await api("PATCH", `/jugadores/${j.id}`, "ana", {
      tipoDocumento: "CC",
      documento: "999888777",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().jugador.documentoEnmascarado).toBe("******777");
    const [despues] = await db.select().from(schema.jugadores).where(eq(schema.jugadores.id, j.id));
    expect(despues?.documentoHash).not.toBe(antes?.documentoHash);
    expect(despues?.version).toBe(2);
  });
});

describe("menores de edad", () => {
  const menor = { fechaNacimiento: "2012-03-01" };
  it("un menor sin autorización del acudiente no queda habilitado", async () => {
    const e = await equipo();
    const r = await api("POST", `/equipos/${e.id}/jugadores`, "ana", adulto(menor));
    const j = r.json().jugador;
    expect(j.esMenor).toBe(true);
    expect(j.habilitado).toBe(false);
    expect(j.autorizacionAcudiente).toBe(false);
  });
  it("con autorización queda habilitado, y se puede registrar o retirar después", async () => {
    const e = await equipo();
    const j1 = (
      await api(
        "POST",
        `/equipos/${e.id}/jugadores`,
        "ana",
        adulto({ ...menor, autorizacionAcudiente: true }),
      )
    ).json().jugador;
    expect(j1.habilitado).toBe(true);
    const j2 = await jugador(e.id, { ...menor, dorsal: 2 });
    const aut = await api("PATCH", `/jugadores/${j2.id}`, "ana", { autorizacionAcudiente: true });
    expect(aut.json().jugador.habilitado).toBe(true);
    const [fila] = await db.select().from(schema.jugadores).where(eq(schema.jugadores.id, j2.id));
    expect(fila?.autorizacionAcudienteEn).not.toBeNull();
    expect(fila?.autorizacionRegistradaPor).toBe(ids.ana);
    const retirada = await api("PATCH", `/jugadores/${j2.id}`, "ana", {
      autorizacionAcudiente: false,
    });
    expect(retirada.json().jugador.habilitado).toBe(false);
  });
  it("un adulto está habilitado sin autorización; cumplir 18 el día exacto cuenta como adulto", async () => {
    const e = await equipo();
    expect(
      (await api("POST", `/equipos/${e.id}/jugadores`, "ana", adulto())).json().jugador.habilitado,
    ).toBe(true);
    const hoy18 = await api(
      "POST",
      `/equipos/${e.id}/jugadores`,
      "ana",
      adulto({ fechaNacimiento: "2008-10-20", dorsal: 21 }),
    );
    expect(hoy18.json().jugador.esMenor).toBe(false);
    const ayer17 = await api(
      "POST",
      `/equipos/${e.id}/jugadores`,
      "ana",
      adulto({ fechaNacimiento: "2008-10-21", dorsal: 22 }),
    );
    expect(ayer17.json().jugador.esMenor).toBe(true);
  });
  it("el estado habilitado viaja en el evento para que matches no alinee a un menor sin permiso", async () => {
    const e = await equipo();
    const j = await jugador(e.id, menor);
    const [ev] = await outbox("jugador.agregado", "jugadorId", j.id);
    expect((ev!.payload as { habilitado: boolean }).habilitado).toBe(false);
  });
});

describe("escudos y fotos", () => {
  it("acepta una imagen real y el escudo se sirve sin sesión", async () => {
    const e = await equipo();
    const m = multipart(PNG);
    const r = await api("PUT", `/equipos/${e.id}/escudo`, "ana", m.payload, m.headers);
    expect(r.statusCode).toBe(200);
    const url = r.json().equipo.escudoUrl as string;
    expect(url).toMatch(/^\/api\/public\/escudos\/[0-9a-f-]{36}\.png$/);
    const pub = await app.inject(url);
    expect(pub.statusCode).toBe(200);
    expect(pub.headers["content-type"]).toBe("image/png");
    expect(pub.rawPayload.equals(PNG)).toBe(true);
    expect(pub.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("rechaza archivos que no son imágenes aunque digan serlo", async () => {
    const e = await equipo();
    for (const falso of [
      Buffer.from("<html><script>alert(1)</script></html>"),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from("MZ\x90\x00 programa.exe"),
    ]) {
      const m = multipart(falso, "image/png", "escudo.png");
      expect(
        (await api("PUT", `/equipos/${e.id}/escudo`, "ana", m.payload, m.headers)).statusCode,
      ).toBe(400);
    }
  });
  it("rechaza archivos demasiado grandes y no guarda nada", async () => {
    const e = await equipo();
    const grande = Buffer.concat([PNG, Buffer.alloc(120_000)]);
    const antes = almacen.archivos.size;
    const m = multipart(grande);
    expect(
      (await api("PUT", `/equipos/${e.id}/escudo`, "ana", m.payload, m.headers)).statusCode,
    ).toBe(413);
    expect(almacen.archivos.size).toBe(antes);
  });
  it("al reemplazar el escudo se borra el anterior", async () => {
    const e = await equipo();
    const m1 = multipart(PNG);
    const primero = (
      await api("PUT", `/equipos/${e.id}/escudo`, "ana", m1.payload, m1.headers)
    ).json().equipo.escudoUrl as string;
    const m2 = multipart(JPG, "image/jpeg", "b.jpg");
    const segundo = (
      await api("PUT", `/equipos/${e.id}/escudo`, "ana", m2.payload, m2.headers)
    ).json().equipo.escudoUrl as string;
    expect(segundo).toMatch(/\.jpg$/);
    expect((await app.inject(primero)).statusCode).toBe(404);
    expect((await app.inject(segundo)).statusCode).toBe(200);
  });
  it("no se pueden pedir archivos con rutas raras ni inexistentes", async () => {
    expect((await app.inject("/api/public/escudos/../../etc/passwd")).statusCode).not.toBe(200);
    expect((await app.inject("/api/public/escudos/x.png")).statusCode).toBe(400);
    expect((await app.inject(`/api/public/escudos/${randomUUID()}.png`)).statusCode).toBe(404);
  });
  it("la foto del jugador solo la ve su delegado (no es pública)", async () => {
    const e = await equipo("ana");
    const j = await jugador(e.id);
    const m = multipart(JPG, "image/jpeg", "f.jpg");
    const sube = await api("PUT", `/jugadores/${j.id}/foto`, "ana", m.payload, m.headers);
    expect(sube.statusCode).toBe(200);
    expect(sube.json().jugador.fotoUrl).toBe(`/api/teams/jugadores/${j.id}/foto`);
    expect((await api("GET", `/jugadores/${j.id}/foto`)).statusCode).toBe(401);
    expect((await api("GET", `/jugadores/${j.id}/foto`, "beto")).statusCode).toBe(404);
    const propia = await api("GET", `/jugadores/${j.id}/foto`, "ana");
    expect(propia.statusCode).toBe(200);
    expect(propia.headers["content-type"]).toBe("image/jpeg");
    expect(propia.headers["cache-control"]).toContain("private");
    const subeBeto = multipart(PNG);
    expect(
      (await api("PUT", `/jugadores/${j.id}/foto`, "beto", subeBeto.payload, subeBeto.headers))
        .statusCode,
    ).toBe(404);
  });
});

describe("administradores de torneo", () => {
  it("ven la plantilla y el carnet solo de equipos inscritos en SU torneo", async () => {
    const e = await equipo("ana");
    const j = await jugador(e.id, { fechaNacimiento: "2012-03-01" });
    const torneoId = randomUUID();
    expect((await api("GET", `/equipos/${e.id}/jugadores`, "admin")).statusCode).toBe(403);
    expect((await api("GET", `/jugadores/${j.id}/carnet`, "admin")).statusCode).toBe(404);

    await db
      .insert(schema.copiaTorneos)
      .values({ torneoId, nombre: "Copa", estado: "inscripciones_abiertas" });
    await db.insert(schema.copiaAdministradoresTorneo).values({ torneoId, usuarioId: ids.admin });
    await db
      .insert(schema.copiaInscripciones)
      .values({ equipoId: e.id, torneoId, estado: "aceptada" });

    expect((await api("GET", `/equipos/${e.id}/jugadores`, "admin")).statusCode).toBe(200);
    expect((await api("GET", `/jugadores/${j.id}/carnet`, "admin")).statusCode).toBe(200);
    const lista = (await api("GET", "/equipos", "admin")).json().equipos as { id: string }[];
    expect(lista.map((x) => x.id)).toContain(e.id);
    // otro administrador, que no administra ese torneo, sigue sin acceso
    expect((await api("GET", `/equipos/${e.id}/jugadores`, "admin2")).statusCode).toBe(403);
    // y el administrador no puede modificar nada
    expect((await api("PATCH", `/jugadores/${j.id}`, "admin", { dorsal: 44 })).statusCode).toBe(
      403,
    );
    expect((await api("DELETE", `/equipos/${e.id}`, "admin")).statusCode).toBe(403);
  });
  it("una inscripción rechazada o retirada quita el acceso", async () => {
    const e = await equipo("ana");
    const torneoId = randomUUID();
    await db.insert(schema.copiaAdministradoresTorneo).values({ torneoId, usuarioId: ids.admin2 });
    await db
      .insert(schema.copiaInscripciones)
      .values({ equipoId: e.id, torneoId, estado: "rechazada" });
    expect((await api("GET", `/equipos/${e.id}/jugadores`, "admin2")).statusCode).toBe(403);
  });
});

describe("carnet digital", () => {
  it("trae nombre, dorsal, posición y equipo, con el documento enmascarado", async () => {
    const e = await equipo("ana", "Carnet FC");
    const j = await jugador(e.id, { documento: "1.234.567", dorsal: 11, posicion: "portero" });
    const r = (await api("GET", `/jugadores/${j.id}/carnet`, "ana")).json();
    expect(r.jugador).toMatchObject({
      nombreCompleto: "Luis Pérez",
      dorsal: 11,
      posicion: "portero",
      documentoEnmascarado: "****567",
      habilitado: true,
    });
    expect(r.equipo.nombre).toBe("Carnet FC");
    expect(JSON.stringify(r)).not.toContain("1234567");
    expect(JSON.stringify(r)).not.toContain("1995");
  });
});

describe("eventos de salida", () => {
  it("no incluyen el documento ni la fecha de nacimiento, y llevan versión creciente", async () => {
    const e = await equipo();
    const j = await jugador(e.id, { documento: "123.456.789", fechaNacimiento: "1990-01-02" });
    await api("PATCH", `/jugadores/${j.id}`, "ana", { dorsal: 14 });
    const evs = [
      ...(await outbox("jugador.agregado", "jugadorId", j.id)),
      ...(await outbox("jugador.actualizado", "jugadorId", j.id)),
    ];
    expect(evs.length).toBe(2);
    for (const ev of evs) {
      const txt = JSON.stringify(ev.payload);
      expect(txt).not.toContain("123456789");
      expect(txt).not.toContain("1990-01-02");
      expect(txt).toContain("documentoHash");
    }
    const versiones = evs.map((x) => (x.payload as { version: number }).version).sort();
    expect(versiones).toEqual([1, 2]);
    expect((await outbox("equipo.creado", "equipoId", e.id)).length).toBe(1);
  });
  it("la auditoría no guarda datos personales", async () => {
    const e = await equipo();
    await jugador(e.id, { documento: "424242424" });
    const filas = await db.select().from(schema.auditoriaTeams);
    expect(JSON.stringify(filas)).not.toContain("424242424");
    expect(filas.some((f) => f.accion === "jugador_agregado")).toBe(true);
  });
});

describe("derecho de supresión (anonimizar)", () => {
  it("borra los datos personales y la foto, conserva el registro y avisa", async () => {
    const e = await equipo();
    const j = await jugador(e.id, { documento: "314159265", nombres: "Marta", apellidos: "Gómez" });
    const m = multipart(JPG, "image/jpeg", "f.jpg");
    await api("PUT", `/jugadores/${j.id}/foto`, "ana", m.payload, m.headers);
    const [antes] = await db.select().from(schema.jugadores).where(eq(schema.jugadores.id, j.id));
    expect(almacen.archivos.has(antes!.fotoUrl!)).toBe(true);

    expect((await api("POST", `/jugadores/${j.id}/anonimizar`, "ana")).statusCode).toBe(204);

    const [fila] = await db.select().from(schema.jugadores).where(eq(schema.jugadores.id, j.id));
    expect(fila).toMatchObject({
      nombres: "Jugador",
      apellidos: "anonimizado",
      documentoCifrado: "",
      fechaNacimiento: null,
      fotoUrl: null,
    });
    expect(fila?.eliminadoEn).not.toBeNull();
    expect(fila?.documentoHash).not.toBe(antes?.documentoHash);
    expect(almacen.archivos.has(antes!.fotoUrl!)).toBe(false);
    expect((await api("GET", `/jugadores/${j.id}/carnet`, "ana")).statusCode).toBe(404);
    const [ev] = await outbox("jugador.eliminado", "jugadorId", j.id);
    expect(ev?.payload).toMatchObject({ anonimizado: true, nombreCompleto: "Jugador anonimizado" });
  });
});

describe("eventos entrantes", () => {
  it("usuario.desactivado marca sus equipos sin delegado, una sola vez", async () => {
    const e1 = await equipo("beto");
    const e2 = await equipo("beto");
    const evento = {
      id: randomUUID(),
      tipo: "usuario.desactivado",
      payload: { usuarioId: ids.beto },
    };
    expect(await app.service.aplicarEvento(evento)).toBe(true);
    expect(await app.service.aplicarEvento(evento)).toBe(false); // repetido
    for (const e of [e1, e2]) {
      const [fila] = await db.select().from(schema.equipos).where(eq(schema.equipos.id, e.id));
      expect(fila?.estado).toBe("sin_delegado");
      expect(fila?.version).toBe(2);
      expect((await outbox("equipo.actualizado", "equipoId", e.id)).length).toBe(1);
    }
  });
});

describe("público y operación", () => {
  it("la vista pública solo expone nombre, municipio y escudo", async () => {
    const e = await equipo("ana", "Público FC");
    const r = await app.inject(`/api/public/equipos/${e.id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().equipo).toEqual({
      id: e.id,
      nombre: "Público FC",
      municipio: "Montería",
      escudoUrl: null,
    });
  });
  it("/ready comprueba la base de datos", async () => {
    const r = await app.inject("/ready");
    expect(r.statusCode).toBe(200);
    expect(r.json().checks).toEqual({ db: "ok" });
  });
});
