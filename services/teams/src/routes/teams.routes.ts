import { authenticate } from "@gestor/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { TeamsConfig } from "../config.js";
import { POSICIONES, TIPOS_DOCUMENTO } from "../dominio.js";
import type { TeamsService } from "../services/teams.service.js";

const id = z.object({ id: z.string().uuid() });
const texto = (min: number, max: number) => z.string().trim().min(min).max(max);

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "Fecha inválida")
  .refine(
    (v) => v >= "1930-01-01" && v <= new Date().toISOString().slice(0, 10),
    "Fecha fuera de rango",
  );

const equipoIn = z.object({ nombre: texto(2, 60), municipio: texto(2, 60) });
const equipoPatch = equipoIn
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Nada que actualizar");

const jugadorIn = z.object({
  nombres: texto(1, 80),
  apellidos: texto(1, 80),
  tipoDocumento: z.enum(TIPOS_DOCUMENTO),
  documento: z
    .string()
    .trim()
    .min(5)
    .max(20)
    .regex(/^[A-Za-z0-9.\- ]+$/, "Documento inválido"),
  fechaNacimiento: fecha,
  dorsal: z.number().int().min(0).max(99),
  posicion: z.enum(POSICIONES),
  autorizacionAcudiente: z.boolean().optional(),
});
const jugadorPatch = jugadorIn
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Nada que actualizar")
  .refine((o) => (o.documento === undefined) === (o.tipoDocumento === undefined), {
    message: "Para cambiar el documento envía tipoDocumento y documento juntos",
  });

export function teamsRoutes(
  service: TeamsService,
  config: TeamsConfig,
  now: () => Date = () => new Date(),
) {
  const actor = (req: FastifyRequest) => req.user!;

  async function archivoSubido(req: FastifyRequest): Promise<Buffer> {
    const f = await req.file();
    if (!f) throw new Error("sin archivo");
    const datos = await f.toBuffer(); // lanza 413 si supera el límite
    if (f.file.truncated)
      throw Object.assign(new Error("Archivo demasiado grande"), { statusCode: 413 });
    return datos;
  }
  const enviarArchivo = (reply: FastifyReply, a: { datos: Buffer; mime: string }, cache: string) =>
    reply
      .header("content-type", a.mime)
      .header("cache-control", cache)
      .header("content-disposition", "inline")
      .send(a.datos);

  return async (app: FastifyInstance) => {
    app.addHook("onRequest", authenticate(config.JWT_SECRET, now));

    // ---- equipos ----
    app.post("/equipos", async (req, reply) =>
      reply
        .status(201)
        .send({ equipo: await service.crearEquipo(actor(req), equipoIn.parse(req.body)) }),
    );
    app.get("/equipos", async (req) => ({ equipos: await service.listarEquipos(actor(req)) }));
    app.get("/equipos/:id", async (req) => ({
      equipo: await service.obtenerEquipo(actor(req), id.parse(req.params).id),
    }));
    app.patch("/equipos/:id", async (req) => ({
      equipo: await service.actualizarEquipo(
        actor(req),
        id.parse(req.params).id,
        equipoPatch.parse(req.body),
      ),
    }));
    app.delete("/equipos/:id", async (req, reply) => {
      await service.eliminarEquipo(actor(req), id.parse(req.params).id);
      return reply.status(204).send();
    });
    app.put("/equipos/:id/escudo", async (req) => ({
      equipo: await service.subirEscudo(
        actor(req),
        id.parse(req.params).id,
        await archivoSubido(req),
      ),
    }));

    // ---- jugadores ----
    app.get("/equipos/:id/jugadores", async (req, reply) => {
      reply.header("cache-control", "no-store");
      return { jugadores: await service.listarJugadores(actor(req), id.parse(req.params).id) };
    });
    app.post("/equipos/:id/jugadores", async (req, reply) =>
      reply
        .status(201)
        .send({
          jugador: await service.agregarJugador(
            actor(req),
            id.parse(req.params).id,
            jugadorIn.parse(req.body),
          ),
        }),
    );
    app.patch("/jugadores/:id", async (req) => ({
      jugador: await service.actualizarJugador(
        actor(req),
        id.parse(req.params).id,
        jugadorPatch.parse(req.body),
      ),
    }));
    app.delete("/jugadores/:id", async (req, reply) => {
      await service.eliminarJugador(actor(req), id.parse(req.params).id);
      return reply.status(204).send();
    });
    app.post("/jugadores/:id/anonimizar", async (req, reply) => {
      await service.anonimizarJugador(actor(req), id.parse(req.params).id);
      return reply.status(204).send();
    });
    app.put("/jugadores/:id/foto", async (req) => ({
      jugador: await service.subirFoto(
        actor(req),
        id.parse(req.params).id,
        await archivoSubido(req),
      ),
    }));
    app.get("/jugadores/:id/foto", async (req, reply) =>
      enviarArchivo(
        reply,
        await service.leerFoto(actor(req), id.parse(req.params).id),
        "private, max-age=300",
      ),
    );
    app.get("/jugadores/:id/carnet", async (req, reply) => {
      reply.header("cache-control", "no-store");
      return service.carnet(actor(req), id.parse(req.params).id);
    });
  };
}

/** Rutas sin sesión, solo lectura: nombre, municipio y escudo. */
export function publicRoutes(service: TeamsService) {
  const archivo = z.object({ nombre: z.string().regex(/^[0-9a-f-]{36}\.(png|jpg|webp)$/) });
  return async (app: FastifyInstance) => {
    app.get("/equipos/:id", async (req, reply) => {
      reply.header("cache-control", "public, max-age=30");
      return { equipo: await service.equipoPublico(id.parse(req.params).id) };
    });
    app.get("/escudos/:nombre", async (req, reply) => {
      const a = await service.leerEscudo(archivo.parse(req.params).nombre);
      return reply
        .header("content-type", a.mime)
        .header("cache-control", "public, max-age=86400, immutable")
        .send(a.datos);
    });
  };
}
