import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { signAccessToken } from "@gestor/shared";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadMatchesConfig } from "./config.js";
import * as schema from "./db/schema.js";
import type { Db } from "./db/types.js";

const SECRET = "j".repeat(40);
const config = loadMatchesConfig({
  PORT: "3003",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://x:y@localhost:5432/z",
  JWT_SECRET: SECRET,
});
const clock = new Date("2026-10-20T12:00:00Z");

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let n = 0;

beforeAll(async () => {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, {
    migrationsFolder: fileURLToPath(new URL("./db/migrations", import.meta.url)),
  });
  db = pg as unknown as Db;
  app = await buildApp({ db, config, now: () => clock });
}, 60_000);

// ---------- ayudantes ----------
interface Usuario {
  id: string;
  token: string;
  correo: string;
}
async function usuario(rol: "admin" | "delegado", nombre = `u${++n}`): Promise<Usuario> {
  const id = randomUUID();
  const correo = `${nombre}${n}@ejemplo.com`;
  const token = await signAccessToken({ id, rol }, SECRET, 900, clock);
  if (rol === "admin")
    await evento("usuario.registrado", { usuarioId: id, correo, nombre, rol: "admin" });
  return { id, token, correo };
}
const evento = (tipo: string, payload: object, id = randomUUID()) =>
  app.service.eventos.aplicar({ id, tipo, payload });
const api = (method: string, url: string, u?: Usuario, payload?: unknown) =>
  app.inject({
    method: method as "GET",
    url,
    payload: payload as object,
    headers: u ? { authorization: `Bearer ${u.token}` } : {},
  });
const M = (u: string) => `/api/matches${u}`;
const P = (u: string) => `/api/public${u}`;

async function equipoCopia(delegado: Usuario, nombre = `Equipo ${++n}`) {
  const equipoId = randomUUID();
  await evento("equipo.creado", {
    equipoId,
    nombre,
    municipio: "Montería",
    escudoUrl: null,
    delegadoId: delegado.id,
    estado: "activo",
    version: 1,
  });
  return { equipoId, nombre };
}
let hashN = 0;
async function jugadorCopia(
  equipoId: string,
  o: { hash?: string; habilitado?: boolean; nombre?: string; dorsal?: number } = {},
) {
  const jugadorId = randomUUID();
  const documentoHash = o.hash ?? `h${++hashN}`.padEnd(64, "0");
  await evento("jugador.agregado", {
    jugadorId,
    equipoId,
    nombreCompleto: o.nombre ?? `Jugador ${++n}`,
    dorsal: o.dorsal ?? 1,
    posicion: "delantero",
    documentoHash,
    habilitado: o.habilitado ?? true,
    version: 1,
  });
  return { jugadorId, documentoHash };
}
async function nuevoTorneo(admin: Usuario, o: object = {}) {
  const r = await api("POST", M("/torneos"), admin, {
    nombre: `Copa ${++n}`,
    temporada: "2026",
    formato: "liguilla",
    ...o,
  });
  expect(r.statusCode).toBe(201);
  return r.json().torneo.id as string;
}
const estado = (id: string, admin: Usuario, e: string) =>
  api("POST", M(`/torneos/${id}/estado`), admin, { estado: e });
const outbox = async (tipo: string, clave?: string, valor?: unknown) =>
  (await db.select().from(schema.eventosSalida)).filter(
    (e) => e.tipo === tipo && (!clave || (e.payload as Record<string, unknown>)[clave] === valor),
  );

/** Equipo con delegado y 2 jugadores, ya inscrito y aceptado. */
async function inscrito(torneoId: string, admin: Usuario, nombre?: string) {
  const del = await usuario("delegado");
  const eq = await equipoCopia(del, nombre);
  const js = [await jugadorCopia(eq.equipoId), await jugadorCopia(eq.equipoId)];
  const s = await api("POST", M(`/torneos/${torneoId}/inscripciones`), del, {
    equipoId: eq.equipoId,
  });
  expect(s.statusCode).toBe(201);
  const inscripcionId = s.json().inscripcion.id as string;
  expect((await api("POST", M(`/inscripciones/${inscripcionId}/aceptar`), admin)).statusCode).toBe(
    200,
  );
  return { del, ...eq, inscripcionId, js };
}
async function torneoEnJuego(
  o: { formato?: string; equipos?: number; extra?: object; admin?: Usuario } = {},
) {
  const admin = o.admin ?? (await usuario("admin"));
  const id = await nuevoTorneo(admin, { formato: o.formato ?? "liguilla", ...o.extra });
  await estado(id, admin, "inscripciones_abiertas");
  const eqs = [];
  for (let i = 0; i < (o.equipos ?? 3); i++) eqs.push(await inscrito(id, admin, `Eq${n++}`));
  return { admin, id, eqs };
}
async function enJuego(t: { admin: Usuario; id: string }) {
  expect((await estado(t.id, t.admin, "en_juego")).statusCode).toBe(200);
}

// ================= TORNEOS Y ADMINISTRADORES =================
describe("torneos y administradores", () => {
  it("solo una cuenta admin crea torneos y queda como administrador, con eventos", async () => {
    const del = await usuario("delegado");
    expect(
      (
        await api("POST", M("/torneos"), del, {
          nombre: "Copa X",
          temporada: "2026",
          formato: "liguilla",
        })
      ).statusCode,
    ).toBe(403);
    expect((await api("POST", M("/torneos"), undefined, {})).statusCode).toBe(401);
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    const admins = (await api("GET", M(`/torneos/${id}/administradores`), admin)).json()
      .administradores;
    expect(admins.map((a: { usuarioId: string }) => a.usuarioId)).toEqual([admin.id]);
    expect((await outbox("torneo.creado", "torneoId", id)).length).toBe(1);
    expect((await outbox("torneo.administrador_agregado", "torneoId", id)).length).toBe(1);
  });
  it("un torneo en borrador solo lo ven sus administradores", async () => {
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    const del = await usuario("delegado");
    expect((await api("GET", M(`/torneos/${id}`), del)).statusCode).toBe(404);
    expect((await api("GET", P(`/torneos/${id}`))).statusCode).toBe(404);
    expect((await api("GET", M(`/torneos/${id}`), admin)).json().torneo.esAdministrador).toBe(true);
    expect(
      ((await api("GET", M("/torneos"), del)).json().torneos as { id: string }[]).some(
        (t) => t.id === id,
      ),
    ).toBe(false);
    await estado(id, admin, "inscripciones_abiertas");
    expect((await api("GET", P(`/torneos/${id}`))).statusCode).toBe(200);
  });
  it("tener la cuenta admin no basta: hay que administrar ESE torneo", async () => {
    const a = await usuario("admin");
    const otro = await usuario("admin");
    const id = await nuevoTorneo(a);
    expect((await api("PATCH", M(`/torneos/${id}`), otro, { nombre: "Robado" })).statusCode).toBe(
      403,
    );
    expect((await estado(id, otro, "inscripciones_abiertas")).statusCode).toBe(403);
    expect((await api("GET", M(`/torneos/${id}/inscripciones`), otro)).statusCode).toBe(403);
    expect((await api("GET", M(`/torneos/${id}/administradores`), otro)).statusCode).toBe(403);
    expect(
      ((await api("GET", M("/torneos"), otro)).json().torneos as { id: string }[]).some(
        (t) => t.id === id,
      ),
    ).toBe(false);
  });
  it("valida la entrada", async () => {
    const admin = await usuario("admin");
    const base = { nombre: "Copa", temporada: "2026", formato: "liguilla" };
    for (const mala of [
      { nombre: "ab" },
      { formato: "eliminacion" },
      { fechaInicio: "2026-02-31" },
      { fechaInicio: "2026-05-10", fechaFin: "2026-05-01" },
      { cupoMaximoEquipos: 1 },
      { criteriosDesempate: ["diferencia_gol", "diferencia_gol"] },
      { criteriosDesempate: ["sorteo"] },
      { puntos: { victoria: 30, empate: 1, derrota: 0 } },
    ]) {
      expect((await api("POST", M("/torneos"), admin, { ...base, ...mala })).statusCode).toBe(400);
    }
  });
  it("controla las transiciones de estado y exige 2 equipos para iniciar", async () => {
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    expect((await estado(id, admin, "en_juego")).statusCode).toBe(409);
    expect((await estado(id, admin, "inscripciones_abiertas")).statusCode).toBe(200);
    expect((await estado(id, admin, "en_juego")).statusCode).toBe(409); // sin equipos
    await inscrito(id, admin);
    expect((await estado(id, admin, "en_juego")).statusCode).toBe(409); // solo 1
    await inscrito(id, admin);
    expect((await estado(id, admin, "en_juego")).statusCode).toBe(200);
    expect((await estado(id, admin, "borrador")).statusCode).toBe(409);
    expect((await estado(id, admin, "finalizado")).statusCode).toBe(200);
    expect((await estado(id, admin, "archivado")).statusCode).toBe(200);
    expect((await outbox("torneo.archivado", "torneoId", id)).length).toBe(1);
    expect((await api("PATCH", M(`/torneos/${id}`), admin, { nombre: "Nuevo" })).statusCode).toBe(
      409,
    );
  });
  it("agrega administradores por correo y mantiene siempre al menos uno", async () => {
    const a = await usuario("admin");
    const b = await usuario("admin");
    const id = await nuevoTorneo(a);
    expect(
      (await api("POST", M(`/torneos/${id}/administradores`), a, { correo: "nadie@ejemplo.com" }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await api("POST", M(`/torneos/${id}/administradores`), a, {
          correo: b.correo.toUpperCase(),
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await api("POST", M(`/torneos/${id}/administradores`), a, { correo: b.correo })).statusCode,
    ).toBe(409);
    expect((await api("GET", M(`/torneos/${id}`), b)).json().torneo.esAdministrador).toBe(true);
    expect((await api("PATCH", M(`/torneos/${id}`), b, { descripcion: "ok" })).statusCode).toBe(
      200,
    );
    // B retira a A (todos son iguales); luego B, que queda solo, no puede retirarse
    expect((await api("DELETE", M(`/torneos/${id}/administradores/${a.id}`), b)).statusCode).toBe(
      204,
    );
    expect((await api("PATCH", M(`/torneos/${id}`), a, { descripcion: "x" })).statusCode).toBe(403);
    const ultimo = await api("DELETE", M(`/torneos/${id}/administradores/${b.id}`), b);
    expect(ultimo.statusCode).toBe(409);
    expect((await outbox("torneo.administrador_retirado", "torneoId", id)).length).toBe(1);
    const aud = await db
      .select()
      .from(schema.auditoriaTorneos)
      .where(eq(schema.auditoriaTorneos.torneoId, id));
    expect(aud.map((x) => x.accion)).toEqual(
      expect.arrayContaining(["administrador_agregado", "administrador_retirado"]),
    );
    // quien fue retirado puede volver a ser agregado
    expect(
      (await api("POST", M(`/torneos/${id}/administradores`), b, { correo: a.correo })).statusCode,
    ).toBe(201);
  });
  it("dos administradores que se retiran a la vez nunca dejan el torneo sin administrador", async () => {
    const a = await usuario("admin");
    const b = await usuario("admin");
    const id = await nuevoTorneo(a);
    await api("POST", M(`/torneos/${id}/administradores`), a, { correo: b.correo });
    const [r1, r2] = await Promise.all([
      api("DELETE", M(`/torneos/${id}/administradores/${b.id}`), a),
      api("DELETE", M(`/torneos/${id}/administradores/${a.id}`), b),
    ]);
    expect([r1.statusCode, r2.statusCode].filter((c) => c === 204).length).toBe(1);
    const activos = (
      await db
        .select()
        .from(schema.administradoresTorneo)
        .where(eq(schema.administradoresTorneo.torneoId, id))
    ).filter((x) => !x.retiradoEn);
    expect(activos.length).toBe(1);
  });
  it("cambiar el cupo no puede quedar por debajo de los equipos ya aceptados", async () => {
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    await estado(id, admin, "inscripciones_abiertas");
    await inscrito(id, admin);
    await inscrito(id, admin);
    expect(
      (await api("PATCH", M(`/torneos/${id}`), admin, { cupoMaximoEquipos: 2 })).statusCode,
    ).toBe(200);
    expect(
      (await api("PATCH", M(`/torneos/${id}`), admin, { cupoMaximoEquipos: 1 })).statusCode,
    ).toBe(400);
  });
});

// ================= INSCRIPCIONES =================
describe("inscripciones", () => {
  async function abierto(extra: object = {}) {
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin, extra);
    await estado(id, admin, "inscripciones_abiertas");
    return { admin, id };
  }
  it("el delegado inscribe SU equipo: queda pendiente y no se puede duplicar", async () => {
    const { id } = await abierto();
    const del = await usuario("delegado");
    const { equipoId } = await equipoCopia(del);
    const r = await api("POST", M(`/torneos/${id}/inscripciones`), del, { equipoId });
    expect(r.statusCode).toBe(201);
    expect(r.json().inscripcion.estado).toBe("pendiente");
    expect(
      (await api("POST", M(`/torneos/${id}/inscripciones`), del, { equipoId })).statusCode,
    ).toBe(409);
    expect((await outbox("inscripcion.solicitada", "torneoId", id)).length).toBe(1);
  });
  it("no se puede inscribir un equipo ajeno, ni como admin, ni con las inscripciones cerradas", async () => {
    const { id, admin } = await abierto();
    const del = await usuario("delegado");
    const otro = await usuario("delegado");
    const { equipoId } = await equipoCopia(del);
    expect(
      (await api("POST", M(`/torneos/${id}/inscripciones`), otro, { equipoId })).statusCode,
    ).toBe(403);
    expect(
      (await api("POST", M(`/torneos/${id}/inscripciones`), admin, { equipoId })).statusCode,
    ).toBe(403);
    const cerrado = await nuevoTorneo(admin);
    expect(
      (await api("POST", M(`/torneos/${cerrado}/inscripciones`), del, { equipoId })).statusCode,
    ).toBe(409);
    const r = await api("POST", M(`/torneos/${id}/inscripciones`), del, { equipoId: randomUUID() });
    expect(r.statusCode).toBe(409); // todavía no llegó el evento del equipo
    expect(r.json().error.message).toContain("Aún no recibimos");
  });
  it("el administrador acepta o rechaza con motivo, y el delegado ve el resultado", async () => {
    const { id, admin } = await abierto();
    const del = await usuario("delegado");
    const { equipoId } = await equipoCopia(del);
    const insc = (await api("POST", M(`/torneos/${id}/inscripciones`), del, { equipoId })).json()
      .inscripcion.id;
    expect((await api("POST", M(`/inscripciones/${insc}/aceptar`), del)).statusCode).toBe(403);
    expect((await api("POST", M(`/inscripciones/${insc}/rechazar`), admin, {})).statusCode).toBe(
      400,
    ); // motivo obligatorio
    expect(
      (
        await api("POST", M(`/inscripciones/${insc}/rechazar`), admin, {
          motivo: "Faltan documentos",
        })
      ).statusCode,
    ).toBe(200);
    expect((await api("POST", M(`/inscripciones/${insc}/aceptar`), admin)).statusCode).toBe(409); // ya decidida
    const mias = (await api("GET", M("/mis-inscripciones"), del)).json().inscripciones;
    expect(mias[0]).toMatchObject({ estado: "rechazada", motivoDecision: "Faltan documentos" });
    expect((await outbox("inscripcion.rechazada", "inscripcionId", insc)).length).toBe(1);
    // tras un rechazo puede volver a solicitar
    expect(
      (await api("POST", M(`/torneos/${id}/inscripciones`), del, { equipoId })).statusCode,
    ).toBe(201);
  });
  it("respeta el cupo máximo de equipos", async () => {
    const { id, admin } = await abierto({ cupoMaximoEquipos: 2 });
    await inscrito(id, admin);
    await inscrito(id, admin);
    const del = await usuario("delegado");
    const { equipoId } = await equipoCopia(del);
    const insc = (await api("POST", M(`/torneos/${id}/inscripciones`), del, { equipoId })).json()
      .inscripcion.id;
    const r = await api("POST", M(`/inscripciones/${insc}/aceptar`), admin);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toContain("cupo");
  });
  it("otro administrador no puede decidir inscripciones de un torneo ajeno", async () => {
    const { id } = await abierto();
    const ajeno = await usuario("admin");
    const del = await usuario("delegado");
    const { equipoId } = await equipoCopia(del);
    const insc = (await api("POST", M(`/torneos/${id}/inscripciones`), del, { equipoId })).json()
      .inscripcion.id;
    expect((await api("POST", M(`/inscripciones/${insc}/aceptar`), ajeno)).statusCode).toBe(403);
  });
});

// ================= PLANTILLAS Y DOCUMENTO ÚNICO =================
describe("plantillas y documento único por torneo", () => {
  const estadoPlantilla = async (inscripcionId: string, jugadorId: string) =>
    (
      await db
        .select()
        .from(schema.plantillasTorneo)
        .where(eq(schema.plantillasTorneo.inscripcionId, inscripcionId))
    ).find((p) => p.jugadorId === jugadorId)?.estado;

  it("al aceptar, los jugadores pasan a la plantilla; un menor sin autorización queda sin habilitar", async () => {
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    await estado(id, admin, "inscripciones_abiertas");
    const del = await usuario("delegado");
    const eq_ = await equipoCopia(del);
    const adulto = await jugadorCopia(eq_.equipoId);
    const menor = await jugadorCopia(eq_.equipoId, { habilitado: false });
    const insc = (
      await api("POST", M(`/torneos/${id}/inscripciones`), del, { equipoId: eq_.equipoId })
    ).json().inscripcion.id;
    await api("POST", M(`/inscripciones/${insc}/aceptar`), admin);
    expect(await estadoPlantilla(insc, adulto.jugadorId)).toBe("habilitado");
    expect(await estadoPlantilla(insc, menor.jugadorId)).toBe("sin_autorizacion");
    // cuando el acudiente autoriza, teams avisa y el jugador queda habilitado
    await evento("jugador.actualizado", {
      jugadorId: menor.jugadorId,
      equipoId: eq_.equipoId,
      nombreCompleto: "Menor",
      dorsal: 2,
      posicion: "defensa",
      documentoHash: menor.documentoHash,
      habilitado: true,
      version: 2,
    });
    expect(await estadoPlantilla(insc, menor.jugadorId)).toBe("habilitado");
    const verAdmin = (await api("GET", M(`/inscripciones/${insc}/plantilla`), admin)).json()
      .plantilla;
    expect(verAdmin.length).toBe(2);
    expect((await api("GET", M(`/inscripciones/${insc}/plantilla`), del)).statusCode).toBe(200);
    expect(
      (await api("GET", M(`/inscripciones/${insc}/plantilla`), await usuario("delegado")))
        .statusCode,
    ).toBe(404);
  });
  it("un mismo documento no puede estar habilitado dos veces en el torneo: el segundo queda en conflicto y se avisa", async () => {
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    await estado(id, admin, "inscripciones_abiertas");
    const hash = "d".repeat(64);
    const a = await usuario("delegado");
    const b = await usuario("delegado");
    const ea = await equipoCopia(a);
    const eb = await equipoCopia(b);
    const ja = await jugadorCopia(ea.equipoId, { hash });
    const jb = await jugadorCopia(eb.equipoId, { hash });
    const ia = (
      await api("POST", M(`/torneos/${id}/inscripciones`), a, { equipoId: ea.equipoId })
    ).json().inscripcion.id;
    const ib = (
      await api("POST", M(`/torneos/${id}/inscripciones`), b, { equipoId: eb.equipoId })
    ).json().inscripcion.id;
    await api("POST", M(`/inscripciones/${ia}/aceptar`), admin);
    await api("POST", M(`/inscripciones/${ib}/aceptar`), admin);
    expect(await estadoPlantilla(ia, ja.jugadorId)).toBe("habilitado");
    expect(await estadoPlantilla(ib, jb.jugadorId)).toBe("en_conflicto");
    expect((await outbox("jugador.en_conflicto", "jugadorId", jb.jugadorId)).length).toBe(1);
    // la base de datos lo impide aunque el código fallara
    await expect(
      db
        .insert(schema.plantillasTorneo)
        .values({
          id: randomUUID(),
          torneoId: id,
          inscripcionId: ib,
          jugadorId: randomUUID(),
          documentoHash: hash,
          estado: "habilitado",
        }),
    ).rejects.toThrow();
    // al retirarse el primer equipo, el documento queda libre y el segundo se habilita
    expect((await api("DELETE", M(`/inscripciones/${ia}`), a)).statusCode).toBe(200);
    expect(await estadoPlantilla(ib, jb.jugadorId)).toBe("habilitado");
  });
  it("el mismo documento sí puede participar en torneos distintos", async () => {
    const hash = "e".repeat(64);
    const del = await usuario("delegado");
    const eq_ = await equipoCopia(del);
    await jugadorCopia(eq_.equipoId, { hash });
    for (let k = 0; k < 2; k++) {
      const admin = await usuario("admin");
      const id = await nuevoTorneo(admin);
      await estado(id, admin, "inscripciones_abiertas");
      const insc = (
        await api("POST", M(`/torneos/${id}/inscripciones`), del, { equipoId: eq_.equipoId })
      ).json().inscripcion.id;
      await api("POST", M(`/inscripciones/${insc}/aceptar`), admin);
      expect(
        (
          await db
            .select()
            .from(schema.plantillasTorneo)
            .where(eq(schema.plantillasTorneo.inscripcionId, insc))
        )[0]?.estado,
      ).toBe("habilitado");
    }
  });
  it("un jugador agregado, cambiado o eliminado en teams actualiza la plantilla del torneo", async () => {
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    await estado(id, admin, "inscripciones_abiertas");
    const t = await inscrito(id, admin);
    const nuevo = await jugadorCopia(t.equipoId); // agregado después de la inscripción
    expect(await estadoPlantilla(t.inscripcionId, nuevo.jugadorId)).toBe("habilitado");
    await evento("jugador.eliminado", {
      jugadorId: nuevo.jugadorId,
      equipoId: t.equipoId,
      version: 2,
    });
    expect(await estadoPlantilla(t.inscripcionId, nuevo.jugadorId)).toBe("retirado");
  });
  it("el delegado puede retirar su inscripción, pero no si ya hay partidos", async () => {
    const t = await torneoEnJuego({ equipos: 2 });
    expect((await api("POST", M(`/torneos/${t.id}/fixture/generar`), t.admin, {})).statusCode).toBe(
      201,
    );
    const r = await api("DELETE", M(`/inscripciones/${t.eqs[0]!.inscripcionId}`), t.eqs[0]!.del);
    expect(r.statusCode).toBe(409);
    expect(
      (
        await api(
          "DELETE",
          M(`/inscripciones/${t.eqs[0]!.inscripcionId}`),
          await usuario("delegado"),
        )
      ).statusCode,
    ).toBe(403);
  });
});

// ================= GRUPOS Y CALENDARIO =================
describe("grupos y calendario", () => {
  it("genera grupos repartiendo los equipos y no permite repetirlos", async () => {
    const t = await torneoEnJuego({ formato: "grupos", equipos: 4 });
    const r = await api("POST", M(`/torneos/${t.id}/grupos/generar`), t.admin, { cantidad: 2 });
    expect(r.statusCode).toBe(201);
    expect(
      r.json().grupos.map((g: { nombre: string; equipos: number }) => [g.nombre, g.equipos]),
    ).toEqual([
      ["Grupo A", 2],
      ["Grupo B", 2],
    ]);
    expect(
      (await api("POST", M(`/torneos/${t.id}/grupos/generar`), t.admin, { cantidad: 2 }))
        .statusCode,
    ).toBe(409);
    const gs = (await api("GET", M(`/torneos/${t.id}/grupos`), t.admin)).json().grupos;
    expect(gs.flatMap((g: { equipos: unknown[] }) => g.equipos).length).toBe(4);
  });
  it("un torneo de liguilla no usa grupos y hacen falta equipos suficientes", async () => {
    const l = await torneoEnJuego({ formato: "liguilla", equipos: 2 });
    expect(
      (await api("POST", M(`/torneos/${l.id}/grupos/generar`), l.admin, { cantidad: 2 }))
        .statusCode,
    ).toBe(409);
    expect(
      (await api("POST", M(`/torneos/${l.id}/grupos`), l.admin, { nombre: "A" })).statusCode,
    ).toBe(409);
    const g = await torneoEnJuego({ formato: "grupos", equipos: 3 });
    expect(
      (await api("POST", M(`/torneos/${g.id}/grupos/generar`), g.admin, { cantidad: 2 }))
        .statusCode,
    ).toBe(409);
  });
  it("genera el calendario por grupo y no deja generarlo dos veces", async () => {
    const t = await torneoEnJuego({ formato: "grupos", equipos: 4 });
    expect((await api("POST", M(`/torneos/${t.id}/fixture/generar`), t.admin, {})).statusCode).toBe(
      409,
    ); // sin grupos
    await api("POST", M(`/torneos/${t.id}/grupos/generar`), t.admin, { cantidad: 2 });
    const r = await api("POST", M(`/torneos/${t.id}/fixture/generar`), t.admin, {});
    expect(r.json().generados).toBe(2); // 1 partido por grupo
    expect((await api("POST", M(`/torneos/${t.id}/fixture/generar`), t.admin, {})).statusCode).toBe(
      409,
    );
    const pub = (await api("GET", P(`/torneos/${t.id}/partidos`))).json().partidos;
    expect(pub.length).toBe(2);
    expect(pub[0].local.inscripcionId).toBeUndefined(); // la vista pública no trae ids internos
    expect(pub[0].grupo).toMatch(/^Grupo/);
  });
  it("liguilla de 6 equipos: 15 partidos en 5 jornadas; ida y vuelta: 30", async () => {
    const t = await torneoEnJuego({ equipos: 6 });
    expect(
      (
        await api("POST", M(`/torneos/${t.id}/fixture/generar`), t.admin, { idaVuelta: true })
      ).json().generados,
    ).toBe(30);
    const ps = (await api("GET", P(`/torneos/${t.id}/partidos`))).json().partidos as {
      jornada: number;
    }[];
    expect(Math.max(...ps.map((p) => p.jornada))).toBe(10);
    const j1 = (await api("GET", P(`/torneos/${t.id}/partidos?jornada=1`))).json().partidos;
    expect(j1.length).toBe(3);
  });
  it("programa, reprograma y cancela partidos con sus eventos", async () => {
    const t = await torneoEnJuego({ equipos: 2 });
    await api("POST", M(`/torneos/${t.id}/fixture/generar`), t.admin, {});
    const p = (await api("GET", P(`/torneos/${t.id}/partidos`))).json().partidos[0];
    const a = await api("PATCH", M(`/partidos/${p.id}`), t.admin, {
      fechaHora: "2026-11-01T15:00:00-05:00",
      cancha: "Estadio Municipal",
    });
    expect(a.statusCode).toBe(200);
    expect((await outbox("partido.programado", "partidoId", p.id)).length).toBe(2); // al generarlo y al ponerle fecha
    await api("PATCH", M(`/partidos/${p.id}`), t.admin, { fechaHora: "2026-11-02T16:00:00-05:00" });
    expect((await outbox("partido.reprogramado", "partidoId", p.id)).length).toBe(1);
    expect(
      (await api("PATCH", M(`/partidos/${p.id}`), t.admin, { fechaHora: "mañana" })).statusCode,
    ).toBe(400);
    expect(
      (await api("PATCH", M(`/partidos/${p.id}`), await usuario("admin"), { cancha: "X" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await api("POST", M(`/partidos/${p.id}/cancelar`), t.admin, { motivo: "Lluvia" }))
        .statusCode,
    ).toBe(204);
    expect((await outbox("partido.cancelado", "partidoId", p.id)).length).toBe(1);
    expect((await api("PATCH", M(`/partidos/${p.id}`), t.admin, { cancha: "Y" })).statusCode).toBe(
      409,
    );
  });
  it("crea un partido manual solo entre equipos aceptados del torneo", async () => {
    const t = await torneoEnJuego({ equipos: 2 });
    const [a, b] = t.eqs;
    const ok = await api("POST", M(`/torneos/${t.id}/partidos`), t.admin, {
      inscripcionLocalId: a!.inscripcionId,
      inscripcionVisitanteId: b!.inscripcionId,
      jornada: 1,
    });
    expect(ok.statusCode).toBe(201);
    expect(
      (
        await api("POST", M(`/torneos/${t.id}/partidos`), t.admin, {
          inscripcionLocalId: a!.inscripcionId,
          inscripcionVisitanteId: a!.inscripcionId,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await api("POST", M(`/torneos/${t.id}/partidos`), t.admin, {
          inscripcionLocalId: a!.inscripcionId,
          inscripcionVisitanteId: randomUUID(),
        })
      ).statusCode,
    ).toBe(400);
  });
});

// ================= RESULTADOS Y POSICIONES =================
describe("resultados y tabla de posiciones", () => {
  async function liguilla3() {
    const t = await torneoEnJuego({ equipos: 3 });
    await api("POST", M(`/torneos/${t.id}/fixture/generar`), t.admin, {});
    const ps = (await api("GET", P(`/torneos/${t.id}/partidos`))).json().partidos as {
      id: string;
      local: { nombre: string };
      visitante: { nombre: string };
    }[];
    const porNombre = new Map(t.eqs.map((e) => [e.nombre, e]));
    const partido = (i: number) => ({
      ...ps[i]!,
      L: porNombre.get(ps[i]!.local.nombre)!,
      V: porNombre.get(ps[i]!.visitante.nombre)!,
    });
    await enJuego(t).catch(() => undefined);
    return { ...t, partido };
  }
  const tabla = async (id: string) =>
    (await api("GET", P(`/torneos/${id}/posiciones`))).json().tablas[0].filas as {
      equipo: { nombre: string };
      pj: number;
      pg: number;
      pe: number;
      pp: number;
      gf: number;
      gc: number;
      dg: number;
      puntos: number;
      posicion: number;
    }[];

  it("registrar un resultado actualiza la tabla en la misma operación", async () => {
    const t = await liguilla3();
    const p = t.partido(0);
    const r = await api("PUT", M(`/partidos/${p.id}/resultado`), t.admin, {
      golesLocal: 3,
      golesVisitante: 1,
      eventos: [],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().partido).toMatchObject({
      estado: "finalizado",
      golesLocal: 3,
      golesVisitante: 1,
    });
    const f = await tabla(t.id);
    expect(f[0]).toMatchObject({
      equipo: { nombre: p.L.nombre },
      pj: 1,
      pg: 1,
      gf: 3,
      gc: 1,
      dg: 2,
      puntos: 3,
      posicion: 1,
    });
    expect(f.find((x) => x.equipo.nombre === p.V.nombre)).toMatchObject({
      pj: 1,
      pp: 1,
      puntos: 0,
    });
    expect(f.find((x) => x.pj === 0)).toBeTruthy(); // el tercero aún no jugó
    expect((await outbox("resultado.registrado", "partidoId", p.id))[0]?.payload).toMatchObject({
      golesLocal: 3,
      golesVisitante: 1,
      correccion: false,
    });
  });
  it("corregir un resultado recalcula todo y reemplaza los eventos anteriores", async () => {
    const t = await liguilla3();
    const p = t.partido(0);
    const g = t.eqs.find((e) => e.nombre === p.L.nombre)!.js[0]!;
    await api("PUT", M(`/partidos/${p.id}/resultado`), t.admin, {
      golesLocal: 2,
      golesVisitante: 0,
      eventos: [{ tipo: "gol", jugadorId: g.jugadorId, minuto: 10 }],
    });
    const c = await api("PUT", M(`/partidos/${p.id}/resultado`), t.admin, {
      golesLocal: 0,
      golesVisitante: 4,
      eventos: [],
    });
    expect(c.statusCode).toBe(200);
    const f = await tabla(t.id);
    expect(f.find((x) => x.equipo.nombre === p.V.nombre)).toMatchObject({
      pg: 1,
      puntos: 3,
      gf: 4,
    });
    expect(f.find((x) => x.equipo.nombre === p.L.nombre)).toMatchObject({
      pp: 1,
      puntos: 0,
      gc: 4,
    });
    expect(
      (
        await db
          .select()
          .from(schema.eventosPartido)
          .where(eq(schema.eventosPartido.partidoId, p.id))
      ).length,
    ).toBe(0);
    const evs = await outbox("resultado.registrado", "partidoId", p.id);
    expect(evs.map((e) => (e.payload as { correccion: boolean }).correccion)).toEqual([
      false,
      true,
    ]);
  });
  it("guarda goles y tarjetas, los publica como eventos y valida su coherencia", async () => {
    const t = await liguilla3();
    const p = t.partido(0);
    const local = t.eqs.find((e) => e.nombre === p.L.nombre)!;
    const visita = t.eqs.find((e) => e.nombre === p.V.nombre)!;
    const ok = await api("PUT", M(`/partidos/${p.id}/resultado`), t.admin, {
      golesLocal: 2,
      golesVisitante: 1,
      eventos: [
        { tipo: "gol", jugadorId: local.js[0]!.jugadorId, minuto: 12 },
        { tipo: "asistencia", jugadorId: local.js[1]!.jugadorId, minuto: 12 },
        { tipo: "autogol", jugadorId: visita.js[0]!.jugadorId, minuto: 40 }, // suma al local
        { tipo: "gol", jugadorId: visita.js[1]!.jugadorId, minuto: 70 },
        { tipo: "amarilla", jugadorId: visita.js[0]!.jugadorId, minuto: 33 },
        { tipo: "roja", jugadorId: local.js[1]!.jugadorId, minuto: 88 },
      ],
    });
    expect(ok.statusCode).toBe(200);
    expect(
      (await outbox("tarjeta.registrada", "partidoId", p.id))
        .map((e) => (e.payload as { tipo: string }).tipo)
        .sort(),
    ).toEqual(["amarilla", "roja"]);
    const gol = await outbox("gol.registrado", "partidoId", p.id);
    expect(gol.length).toBe(3);
    expect(gol.some((e) => (e.payload as { autogol: boolean }).autogol)).toBe(true);
    const d = (await api("GET", M(`/partidos/${p.id}`), t.admin)).json();
    expect(d.eventos.length).toBe(6);
    expect(d.eventos[0]).toHaveProperty("jugador");
  });
  it("rechaza datos incoherentes", async () => {
    const t = await liguilla3();
    const p = t.partido(0);
    const local = t.eqs.find((e) => e.nombre === p.L.nombre)!;
    const tercero = t.eqs.find((e) => e.nombre !== p.L.nombre && e.nombre !== p.V.nombre)!;
    const put = (body: object, u = t.admin) =>
      api("PUT", M(`/partidos/${p.id}/resultado`), u, body);
    expect(
      (
        await put({
          golesLocal: 1,
          golesVisitante: 0,
          eventos: [
            { tipo: "gol", jugadorId: local.js[0]!.jugadorId, minuto: 1 },
            { tipo: "gol", jugadorId: local.js[1]!.jugadorId, minuto: 2 },
          ],
        })
      ).statusCode,
    ).toBe(400); // más goles que el marcador
    expect(
      (
        await put({
          golesLocal: 1,
          golesVisitante: 0,
          eventos: [{ tipo: "gol", jugadorId: tercero.js[0]!.jugadorId, minuto: 1 }],
        })
      ).statusCode,
    ).toBe(400); // jugador de otro equipo
    expect(
      (
        await put({
          golesLocal: 0,
          golesVisitante: 0,
          eventos: [
            { tipo: "roja", jugadorId: local.js[0]!.jugadorId, minuto: 1 },
            { tipo: "roja", jugadorId: local.js[0]!.jugadorId, minuto: 2 },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put({
          golesLocal: 0,
          golesVisitante: 0,
          eventos: [1, 2, 3].map((m) => ({
            tipo: "amarilla",
            jugadorId: local.js[0]!.jugadorId,
            minuto: m,
          })),
        })
      ).statusCode,
    ).toBe(400);
    expect((await put({ golesLocal: -1, golesVisitante: 0 })).statusCode).toBe(400);
    expect(
      (
        await put({
          golesLocal: 0,
          golesVisitante: 0,
          eventos: [{ tipo: "gol", jugadorId: randomUUID(), minuto: 200 }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await put({ golesLocal: 1, golesVisitante: 0 }, await usuario("admin"))).statusCode,
    ).toBe(403);
    expect(
      (await put({ golesLocal: 1, golesVisitante: 0 }, await usuario("delegado"))).statusCode,
    ).toBe(403);
    // nada de lo anterior dejó datos a medias
    expect(
      (await db.select().from(schema.partidos).where(eq(schema.partidos.id, p.id)))[0]?.estado,
    ).toBe("programado");
    expect((await tabla(t.id)).every((f) => f.pj === 0)).toBe(true);
  });
  it("un jugador no habilitado (menor sin autorización) no puede figurar en el partido", async () => {
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    await estado(id, admin, "inscripciones_abiertas");
    const a = await usuario("delegado");
    const b = await usuario("delegado");
    const ea = await equipoCopia(a, "Ea");
    const eb = await equipoCopia(b, "Eb");
    const menor = await jugadorCopia(ea.equipoId, { habilitado: false });
    await jugadorCopia(eb.equipoId);
    for (const [u, e] of [
      [a, ea],
      [b, eb],
    ] as const) {
      const i = (
        await api("POST", M(`/torneos/${id}/inscripciones`), u, { equipoId: e.equipoId })
      ).json().inscripcion.id;
      await api("POST", M(`/inscripciones/${i}/aceptar`), admin);
    }
    await estado(id, admin, "en_juego");
    await api("POST", M(`/torneos/${id}/fixture/generar`), admin, {});
    const p = (await api("GET", P(`/torneos/${id}/partidos`))).json().partidos[0];
    const r = await api("PUT", M(`/partidos/${p.id}/resultado`), admin, {
      golesLocal: 1,
      golesVisitante: 0,
      eventos: [{ tipo: "gol", jugadorId: menor.jugadorId, minuto: 5 }],
    });
    expect(r.statusCode).toBe(400);
  });
  it("solo se registran resultados con el torneo en juego y en partidos no cancelados", async () => {
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    await estado(id, admin, "inscripciones_abiertas");
    const [a, b] = [await inscrito(id, admin), await inscrito(id, admin)];
    await api("POST", M(`/torneos/${id}/fixture/generar`), admin, {});
    const p = (await api("GET", P(`/torneos/${id}/partidos`))).json().partidos[0];
    expect(
      (
        await api("PUT", M(`/partidos/${p.id}/resultado`), admin, {
          golesLocal: 1,
          golesVisitante: 0,
        })
      ).statusCode,
    ).toBe(409); // aún no está en juego
    await estado(id, admin, "en_juego");
    await api("POST", M(`/partidos/${p.id}/cancelar`), admin, {});
    expect(
      (
        await api("PUT", M(`/partidos/${p.id}/resultado`), admin, {
          golesLocal: 1,
          golesVisitante: 0,
        })
      ).statusCode,
    ).toBe(409);
    void a;
    void b;
  });
  it("cambiar los criterios de desempate recalcula la tabla", async () => {
    const t = await torneoEnJuego({
      equipos: 4,
      extra: { criteriosDesempate: ["diferencia_gol"] },
    });
    await enJuego(t);
    const [A, B, C, D] = t.eqs;
    const mk = async (l: typeof A, v: typeof A, gl: number, gv: number) => {
      const p = (
        await api("POST", M(`/torneos/${t.id}/partidos`), t.admin, {
          inscripcionLocalId: l!.inscripcionId,
          inscripcionVisitanteId: v!.inscripcionId,
        })
      ).json().partido;
      expect(
        (
          await api("PUT", M(`/partidos/${p.id}/resultado`), t.admin, {
            golesLocal: gl,
            golesVisitante: gv,
          })
        ).statusCode,
      ).toBe(200);
    };
    // A y B terminan con 4 pts; A ganó el duelo directo pero B tiene mejor diferencia de gol
    await mk(A, B, 1, 0);
    await mk(A, C, 0, 0);
    await mk(A, D, 0, 2);
    await mk(B, C, 5, 0);
    await mk(B, D, 0, 0);
    await mk(C, D, 0, 0);
    const orden = async () => (await tabla(t.id)).map((f) => f.equipo.nombre);
    expect(await orden()).toEqual([D!.nombre, B!.nombre, A!.nombre, C!.nombre]);
    expect(
      (
        await api("PATCH", M(`/torneos/${t.id}`), t.admin, {
          criteriosDesempate: ["enfrentamiento_directo"],
        })
      ).statusCode,
    ).toBe(200);
    expect(await orden()).toEqual([D!.nombre, A!.nombre, B!.nombre, C!.nombre]);
    // y los puntos por victoria también se aplican
    await api("PATCH", M(`/torneos/${t.id}`), t.admin, {
      puntos: { victoria: 2, empate: 1, derrota: 0 },
    });
    expect((await tabla(t.id)).find((f) => f.equipo.nombre === D!.nombre)?.puntos).toBe(4);
  });
  it("calcula goleadores, asistentes y valla menos vencida (con sesión)", async () => {
    const t = await liguilla3();
    const p = t.partido(0);
    const local = t.eqs.find((e) => e.nombre === p.L.nombre)!;
    await api("PUT", M(`/partidos/${p.id}/resultado`), t.admin, {
      golesLocal: 2,
      golesVisitante: 0,
      eventos: [
        { tipo: "gol", jugadorId: local.js[0]!.jugadorId, minuto: 5 },
        { tipo: "gol", jugadorId: local.js[0]!.jugadorId, minuto: 50 },
        { tipo: "asistencia", jugadorId: local.js[1]!.jugadorId, minuto: 5 },
      ],
    });
    expect((await api("GET", M(`/torneos/${t.id}/estadisticas`))).statusCode).toBe(401);
    const s = (
      await api("GET", M(`/torneos/${t.id}/estadisticas`), await usuario("delegado"))
    ).json();
    expect(s.goleadores[0]).toMatchObject({ equipo: local.nombre, total: 2 });
    expect(s.asistentes[0].total).toBe(1);
    expect(s.vallaMenosVencida[0]).toMatchObject({
      equipo: local.nombre,
      golesContra: 0,
      promedio: 0,
    });
  });
});

// ================= EXCEL Y VISTAS PÚBLICAS =================
describe("exportación a Excel y vistas públicas", () => {
  it("genera un .xlsx con una hoja por grupo, y los nombres se guardan como texto", async () => {
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin, { formato: "grupos", nombre: "Copa Excel" });
    await estado(id, admin, "inscripciones_abiertas");
    const eqs = [
      await inscrito(id, admin, "=SUMA(1+1)"),
      await inscrito(id, admin, "Beta"),
      await inscrito(id, admin, "Gama"),
      await inscrito(id, admin, "Delta"),
    ];
    await estado(id, admin, "en_juego");
    await api("POST", M(`/torneos/${id}/grupos/generar`), admin, { cantidad: 2 });
    const r = await api("GET", P(`/torneos/${id}/posiciones.xlsx`));
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(r.headers["content-disposition"]).toContain("attachment");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Grupo A", "Grupo B"]);
    const hoja = wb.getWorksheet("Grupo A")!;
    expect(hoja.getRow(3).values).toEqual(expect.arrayContaining(["Pos", "Equipo", "PJ", "Pts"]));
    const nombres = wb.worksheets.flatMap((w) =>
      w.getSheetValues().flatMap((v) => (Array.isArray(v) ? v : [])),
    );
    const formula = nombres.find((v) => typeof v === "string" && v.includes("SUMA"));
    expect(formula).toBe("=SUMA(1+1)"); // texto, no fórmula
    void eqs;
  });
  it("las vistas públicas no exponen datos personales ni ids internos", async () => {
    const t = await torneoEnJuego({ equipos: 2 });
    await api("POST", M(`/torneos/${t.id}/fixture/generar`), t.admin, {});
    const posiciones = (await api("GET", P(`/torneos/${t.id}/posiciones`))).body;
    const partidos = (await api("GET", P(`/torneos/${t.id}/partidos`))).body;
    const torneo = (await api("GET", P(`/torneos/${t.id}`))).body;
    for (const cuerpo of [posiciones, partidos, torneo]) {
      expect(cuerpo).not.toContain("documento");
      expect(cuerpo).not.toContain("delegado");
      expect(cuerpo).not.toContain("creadoPor");
    }
    expect((await api("GET", P(`/torneos/${t.id}/posiciones`))).headers["cache-control"]).toBe(
      "public, max-age=5",
    );
    expect(
      (await api("GET", P("/torneos"))).json().torneos.some((x: { id: string }) => x.id === t.id),
    ).toBe(true);
    expect((await api("GET", P(`/torneos/${randomUUID()}/posiciones`))).statusCode).toBe(404);
    expect((await api("GET", P("/torneos/no-uuid"))).statusCode).toBe(400);
  });
});

// ================= EVENTOS ENTRANTES =================
describe("eventos entrantes de otros servicios", () => {
  it("son idempotentes y descartan versiones viejas", async () => {
    const del = await usuario("delegado");
    const equipoId = randomUUID();
    const ev = {
      equipoId,
      nombre: "Nuevo",
      municipio: "X",
      escudoUrl: null,
      delegadoId: del.id,
      estado: "activo",
    };
    const id = randomUUID();
    expect(await evento("equipo.creado", { ...ev, version: 2 }, id)).toBe(true);
    expect(await evento("equipo.creado", { ...ev, version: 2 }, id)).toBe(false); // el mismo evento otra vez
    expect(await evento("equipo.actualizado", { ...ev, nombre: "Viejo", version: 1 })).toBe(true); // llega tarde
    expect(
      (
        await db
          .select()
          .from(schema.copiaEquipos)
          .where(eq(schema.copiaEquipos.equipoId, equipoId))
      )[0],
    ).toMatchObject({ nombre: "Nuevo", version: 2 });
    await evento("equipo.actualizado", { ...ev, nombre: "Renombrado", version: 3 });
    expect(
      (
        await db
          .select()
          .from(schema.copiaEquipos)
          .where(eq(schema.copiaEquipos.equipoId, equipoId))
      )[0]?.nombre,
    ).toBe("Renombrado");
    await evento("equipo.eliminado", { equipoId, version: 4 });
    expect(
      (
        await db
          .select()
          .from(schema.copiaEquipos)
          .where(eq(schema.copiaEquipos.equipoId, equipoId))
      )[0]?.eliminado,
    ).toBe(true);
  });
  it("solo copia las cuentas de administrador y respeta la desactivación", async () => {
    const delId = randomUUID();
    await evento("usuario.registrado", {
      usuarioId: delId,
      correo: "del@ejemplo.com",
      nombre: "Del",
      rol: "delegado",
    });
    expect(
      (
        await db
          .select()
          .from(schema.copiaUsuariosAdmin)
          .where(eq(schema.copiaUsuariosAdmin.usuarioId, delId))
      ).length,
    ).toBe(0);
    const a = await usuario("admin");
    await evento("usuario.desactivado", { usuarioId: a.id });
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    expect(
      (await api("POST", M(`/torneos/${id}/administradores`), admin, { correo: a.correo }))
        .statusCode,
    ).toBe(404); // desactivada: no se puede agregar
  });
  it("un jugador eliminado o anonimizado se refleja en la copia", async () => {
    const del = await usuario("delegado");
    const e = await equipoCopia(del);
    const j = await jugadorCopia(e.equipoId, { nombre: "Marta Gómez" });
    await evento("jugador.eliminado", {
      jugadorId: j.jugadorId,
      equipoId: e.equipoId,
      anonimizado: true,
      nombreCompleto: "Jugador anonimizado",
      version: 2,
    });
    expect(
      (
        await db
          .select()
          .from(schema.copiaJugadores)
          .where(eq(schema.copiaJugadores.jugadorId, j.jugadorId))
      )[0],
    ).toMatchObject({ eliminado: true, nombreCompleto: "Jugador anonimizado" });
  });
  it("/ready comprueba la base de datos", async () => {
    const r = await app.inject("/ready");
    expect(r.statusCode).toBe(200);
    expect(r.json().checks).toEqual({ db: "ok" });
  });
});

describe("publicación del outbox", () => {
  it("entrega los eventos del torneo al bus una sola vez", async () => {
    const { crearOutboxStore } = await import("./bus.js");
    const store = crearOutboxStore(db);
    while ((await store.procesarLote(async () => {})) > 0); // vacía lo acumulado por otras pruebas (lotes de 100)
    const admin = await usuario("admin");
    const id = await nuevoTorneo(admin);
    const publicados: { tipo: string; payload: unknown }[] = [];
    while ((await store.procesarLote(async (lote) => void publicados.push(...lote))) > 0);
    expect(
      publicados
        .filter((e) => (e.payload as { torneoId: string }).torneoId === id)
        .map((e) => e.tipo)
        .sort(),
    ).toEqual(["torneo.administrador_agregado", "torneo.creado"]);
    expect(await store.procesarLote(async () => {})).toBe(0);
  });
});
