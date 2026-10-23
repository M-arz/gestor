import { authenticate } from "@gestor/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { MatchesConfig } from "../config.js";
import { CRITERIOS, ESTADOS_TORNEO, FASES, FORMATOS, TIPOS_EVENTO } from "../dominio.js";
import type { MatchesService } from "../services/matches.service.js";

const uuid = z.string().uuid();
const id = z.object({ id: uuid });
const texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD")
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Fecha inválida");
const puntos = z.number().int().min(0).max(10);

const torneoBase = z.object({
  nombre: texto(3, 100),
  descripcion: z.string().trim().max(500).optional(),
  temporada: texto(1, 30),
  fechaInicio: fecha.optional(),
  fechaFin: fecha.optional(),
  cupoMaximoEquipos: z.number().int().min(2).max(128).optional(),
  puntos: z.object({ victoria: puntos, empate: puntos, derrota: puntos }).optional(),
  criteriosDesempate: z
    .array(z.enum(CRITERIOS))
    .max(5)
    .refine((a) => new Set(a).size === a.length, "Criterios repetidos")
    .optional(),
});
const fechasOk = (o: { fechaInicio?: string; fechaFin?: string }) =>
  !o.fechaInicio || !o.fechaFin || o.fechaFin >= o.fechaInicio;
const torneoIn = torneoBase
  .extend({ formato: z.enum(FORMATOS) })
  .refine(fechasOk, "La fecha de fin no puede ser anterior a la de inicio");
const torneoPatch = torneoBase
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Nada que actualizar")
  .refine(fechasOk, "La fecha de fin no puede ser anterior a la de inicio");

const resultadoIn = z.object({
  golesLocal: z.number().int().min(0).max(99),
  golesVisitante: z.number().int().min(0).max(99),
  eventos: z
    .array(
      z.object({
        tipo: z.enum(TIPOS_EVENTO),
        jugadorId: uuid,
        minuto: z.number().int().min(0).max(130),
      }),
    )
    .max(60)
    .default([]),
});
const fechaHora = z.string().datetime({ offset: true });
const partidoIn = z.object({
  inscripcionLocalId: uuid,
  inscripcionVisitanteId: uuid,
  jornada: z.number().int().min(1).max(100).optional(),
  fase: z.enum(FASES).optional(),
  grupoId: uuid.optional(),
  fechaHora: fechaHora.optional(),
  cancha: texto(1, 80).optional(),
});
const partidoPatch = z
  .object({
    fechaHora: fechaHora.nullable().optional(),
    cancha: texto(1, 80).nullable().optional(),
    jornada: z.number().int().min(1).max(100).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "Nada que actualizar");

export function matchesRoutes(
  service: MatchesService,
  config: MatchesConfig,
  now: () => Date = () => new Date(),
) {
  const actor = (req: FastifyRequest) => req.user!;
  return async (app: FastifyInstance) => {
    app.addHook("onRequest", authenticate(config.JWT_SECRET, now));

    // ---- torneos ----
    app.post("/torneos", async (req, reply) =>
      reply
        .status(201)
        .send({ torneo: await service.torneos.crear(actor(req), torneoIn.parse(req.body)) }),
    );
    app.get("/torneos", async (req) => ({ torneos: await service.torneos.listar(actor(req)) }));
    app.get("/torneos/:id", async (req) => ({
      torneo: await service.torneos.obtener(actor(req), id.parse(req.params).id),
    }));
    app.patch("/torneos/:id", async (req) => ({
      torneo: await service.torneos.actualizar(
        actor(req),
        id.parse(req.params).id,
        torneoPatch.parse(req.body),
      ),
    }));
    app.post("/torneos/:id/estado", async (req) => ({
      torneo: await service.torneos.cambiarEstado(
        actor(req),
        id.parse(req.params).id,
        z.object({ estado: z.enum(ESTADOS_TORNEO) }).parse(req.body).estado,
      ),
    }));

    // ---- administradores del torneo ----
    app.get("/torneos/:id/administradores", async (req) => ({
      administradores: await service.torneos.administradores(actor(req), id.parse(req.params).id),
    }));
    app.post("/torneos/:id/administradores", async (req, reply) =>
      reply.status(201).send({
        administrador: await service.torneos.agregarAdministrador(
          actor(req),
          id.parse(req.params).id,
          z.object({ correo: z.string().trim().toLowerCase().email() }).parse(req.body).correo,
        ),
      }),
    );
    app.delete("/torneos/:id/administradores/:usuarioId", async (req, reply) => {
      const p = z.object({ id: uuid, usuarioId: uuid }).parse(req.params);
      await service.torneos.retirarAdministrador(actor(req), p.id, p.usuarioId);
      return reply.status(204).send();
    });

    // ---- inscripciones ----
    app.post("/torneos/:id/inscripciones", async (req, reply) =>
      reply.status(201).send({
        inscripcion: await service.inscripciones.solicitar(
          actor(req),
          id.parse(req.params).id,
          z.object({ equipoId: uuid }).parse(req.body).equipoId,
        ),
      }),
    );
    app.get("/torneos/:id/inscripciones", async (req) => ({
      inscripciones: await service.inscripciones.listarDelTorneo(
        actor(req),
        id.parse(req.params).id,
      ),
    }));
    app.get("/mis-inscripciones", async (req) => ({
      inscripciones: await service.inscripciones.misInscripciones(actor(req)),
    }));
    app.post("/inscripciones/:id/aceptar", async (req) => ({
      inscripcion: await service.inscripciones.aceptar(actor(req), id.parse(req.params).id),
    }));
    app.post("/inscripciones/:id/rechazar", async (req) => ({
      inscripcion: await service.inscripciones.rechazar(
        actor(req),
        id.parse(req.params).id,
        z.object({ motivo: texto(1, 300) }).parse(req.body).motivo,
      ),
    }));
    app.delete("/inscripciones/:id", async (req) => ({
      inscripcion: await service.inscripciones.retirar(actor(req), id.parse(req.params).id),
    }));
    app.get("/inscripciones/:id/plantilla", async (req, reply) => {
      reply.header("cache-control", "no-store");
      return {
        plantilla: await service.inscripciones.plantilla(actor(req), id.parse(req.params).id),
      };
    });

    // ---- grupos ----
    app.get("/torneos/:id/grupos", async (req) => ({
      grupos: await service.inscripciones.listarGrupos(actor(req), id.parse(req.params).id),
    }));
    app.post("/torneos/:id/grupos", async (req, reply) =>
      reply
        .status(201)
        .send({
          grupo: await service.inscripciones.crearGrupo(
            actor(req),
            id.parse(req.params).id,
            z.object({ nombre: texto(1, 30) }).parse(req.body).nombre,
          ),
        }),
    );
    app.post("/torneos/:id/grupos/generar", async (req, reply) =>
      reply.status(201).send({
        grupos: await service.inscripciones.generarGrupos(
          actor(req),
          id.parse(req.params).id,
          z.object({ cantidad: z.number().int().min(2).max(16) }).parse(req.body).cantidad,
        ),
      }),
    );
    app.put("/inscripciones/:id/grupo", async (req, reply) => {
      await service.inscripciones.asignarGrupo(
        actor(req),
        id.parse(req.params).id,
        z.object({ grupoId: uuid.nullable() }).parse(req.body).grupoId,
      );
      return reply.status(204).send();
    });

    // ---- calendario y partidos ----
    app.post("/torneos/:id/fixture/generar", async (req, reply) =>
      reply
        .status(201)
        .send(
          await service.partidos.generarFixture(
            actor(req),
            id.parse(req.params).id,
            z
              .object({ grupoId: uuid.optional(), idaVuelta: z.boolean().optional() })
              .parse(req.body ?? {}),
          ),
        ),
    );
    app.post("/torneos/:id/partidos", async (req, reply) =>
      reply
        .status(201)
        .send({
          partido: await service.partidos.crearPartido(
            actor(req),
            id.parse(req.params).id,
            partidoIn.parse(req.body),
          ),
        }),
    );
    app.get("/partidos/:id", async (req) =>
      service.partidos.detalle(actor(req), id.parse(req.params).id),
    );
    app.patch("/partidos/:id", async (req) => ({
      partido: await service.partidos.actualizarPartido(
        actor(req),
        id.parse(req.params).id,
        partidoPatch.parse(req.body),
      ),
    }));
    app.post("/partidos/:id/cancelar", async (req, reply) => {
      await service.partidos.cancelarPartido(
        actor(req),
        id.parse(req.params).id,
        z.object({ motivo: texto(1, 200).optional() }).parse(req.body ?? {}).motivo,
      );
      return reply.status(204).send();
    });
    app.put("/partidos/:id/resultado", async (req) => ({
      partido: await service.partidos.registrarResultado(
        actor(req),
        id.parse(req.params).id,
        resultadoIn.parse(req.body),
      ),
    }));

    app.get("/torneos/:id/estadisticas", async (req) =>
      service.estadisticas(actor(req), id.parse(req.params).id),
    );
  };
}

/** Vistas públicas: sin sesión, solo lectura, con caché corta. */
export function publicRoutes(service: MatchesService) {
  const cache = "public, max-age=5";
  return async (app: FastifyInstance) => {
    app.get("/torneos", async (_req, reply) => {
      reply.header("cache-control", cache);
      return { torneos: await service.torneosPublicos() };
    });
    app.get("/torneos/:id", async (req, reply) => {
      reply.header("cache-control", cache);
      return { torneo: await service.torneoPublico(id.parse(req.params).id) };
    });
    app.get("/torneos/:id/posiciones", async (req, reply) => {
      reply.header("cache-control", cache);
      return { tablas: await service.posicionesPublicas(id.parse(req.params).id) };
    });
    app.get("/torneos/:id/posiciones.xlsx", async (req, reply) => {
      const x = await service.posicionesExcel(id.parse(req.params).id);
      return reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="${x.nombre}"`)
        .header("cache-control", cache)
        .send(x.datos);
    });
    app.get("/torneos/:id/partidos", async (req, reply) => {
      const q = z
        .object({
          grupoId: uuid.optional(),
          jornada: z.coerce.number().int().min(1).optional(),
          estado: z
            .enum(["programado", "en_juego", "finalizado", "aplazado", "cancelado"])
            .optional(),
        })
        .parse(req.query);
      reply.header("cache-control", cache);
      return { partidos: await service.listarPartidos(id.parse(req.params).id, q) };
    });
  };
}
