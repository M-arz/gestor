import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const torneos = pgTable(
  "torneos",
  {
    id: uuid("id").primaryKey(),
    nombre: text("nombre").notNull(),
    descripcion: text("descripcion"),
    temporada: text("temporada").notNull(),
    formato: text("formato", { enum: ["grupos", "liguilla"] }).notNull(),
    estado: text("estado", {
      enum: ["borrador", "inscripciones_abiertas", "en_juego", "finalizado", "archivado"],
    })
      .notNull()
      .default("borrador"),
    fechaInicio: date("fecha_inicio", { mode: "string" }),
    fechaFin: date("fecha_fin", { mode: "string" }),
    cupoMaximoEquipos: integer("cupo_maximo_equipos"),
    puntosVictoria: integer("puntos_victoria").notNull().default(3),
    puntosEmpate: integer("puntos_empate").notNull().default(1),
    puntosDerrota: integer("puntos_derrota").notNull().default(0),
    /** Lista ordenada de criterios tras los puntos. */
    criteriosDesempate: jsonb("criterios_desempate").$type<string[]>().notNull(),
    creadoPor: uuid("creado_por").notNull(),
    version: integer("version").notNull().default(1),
    creadoEn: ts("creado_en").notNull().defaultNow(),
    actualizadoEn: ts("actualizado_en").notNull().defaultNow(),
    archivadoEn: ts("archivado_en"),
  },
  (t) => [
    check("torneos_formato_chk", sql`${t.formato} in ('grupos','liguilla')`),
    check(
      "torneos_estado_chk",
      sql`${t.estado} in ('borrador','inscripciones_abiertas','en_juego','finalizado','archivado')`,
    ),
    check("torneos_cupo_chk", sql`${t.cupoMaximoEquipos} is null or ${t.cupoMaximoEquipos} >= 2`),
  ],
);

export const administradoresTorneo = pgTable(
  "administradores_torneo",
  {
    torneoId: uuid("torneo_id")
      .notNull()
      .references(() => torneos.id),
    usuarioId: uuid("usuario_id").notNull(),
    agregadoPor: uuid("agregado_por").notNull(),
    agregadoEn: ts("agregado_en").notNull().defaultNow(),
    /** Nulo = administrador activo. */
    retiradoEn: ts("retirado_en"),
  },
  (t) => [primaryKey({ columns: [t.torneoId, t.usuarioId] })],
);

export const inscripciones = pgTable(
  "inscripciones",
  {
    id: uuid("id").primaryKey(),
    torneoId: uuid("torneo_id")
      .notNull()
      .references(() => torneos.id),
    equipoId: uuid("equipo_id").notNull(),
    solicitadaPor: uuid("solicitada_por").notNull(),
    estado: text("estado", { enum: ["pendiente", "aceptada", "rechazada", "retirada"] })
      .notNull()
      .default("pendiente"),
    motivoDecision: text("motivo_decision"),
    decididaPor: uuid("decidida_por"),
    decididaEn: ts("decidida_en"),
    version: integer("version").notNull().default(1),
    creadoEn: ts("creado_en").notNull().defaultNow(),
  },
  (t) => [
    // Un equipo solo puede tener una inscripción viva por torneo.
    uniqueIndex("inscripciones_equipo_torneo_unica")
      .on(t.torneoId, t.equipoId)
      .where(sql`${t.estado} in ('pendiente','aceptada')`),
    index("inscripciones_torneo_idx").on(t.torneoId),
    index("inscripciones_equipo_idx").on(t.equipoId),
    check(
      "inscripciones_estado_chk",
      sql`${t.estado} in ('pendiente','aceptada','rechazada','retirada')`,
    ),
  ],
);

export const grupos = pgTable(
  "grupos",
  {
    id: uuid("id").primaryKey(),
    torneoId: uuid("torneo_id")
      .notNull()
      .references(() => torneos.id),
    nombre: text("nombre").notNull(),
    orden: integer("orden").notNull(),
  },
  (t) => [unique("grupos_torneo_nombre_unico").on(t.torneoId, t.nombre)],
);

export const grupoEquipos = pgTable(
  "grupo_equipos",
  {
    grupoId: uuid("grupo_id")
      .notNull()
      .references(() => grupos.id),
    inscripcionId: uuid("inscripcion_id")
      .notNull()
      .references(() => inscripciones.id),
  },
  (t) => [
    primaryKey({ columns: [t.grupoId, t.inscripcionId] }),
    // Una inscripción está en un solo grupo.
    unique("grupo_equipos_inscripcion_unica").on(t.inscripcionId),
  ],
);

export const plantillasTorneo = pgTable(
  "plantillas_torneo",
  {
    id: uuid("id").primaryKey(),
    torneoId: uuid("torneo_id")
      .notNull()
      .references(() => torneos.id),
    inscripcionId: uuid("inscripcion_id")
      .notNull()
      .references(() => inscripciones.id),
    jugadorId: uuid("jugador_id").notNull(),
    documentoHash: text("documento_hash").notNull(),
    estado: text("estado", {
      enum: ["habilitado", "en_conflicto", "sin_autorizacion", "retirado"],
    }).notNull(),
    creadoEn: ts("creado_en").notNull().defaultNow(),
  },
  (t) => [
    unique("plantillas_inscripcion_jugador_unica").on(t.inscripcionId, t.jugadorId),
    // La regla del documento único por torneo la garantiza la propia base de datos.
    uniqueIndex("plantillas_documento_habilitado_unico")
      .on(t.torneoId, t.documentoHash)
      .where(sql`${t.estado} = 'habilitado'`),
    index("plantillas_jugador_idx").on(t.jugadorId),
    check(
      "plantillas_estado_chk",
      sql`${t.estado} in ('habilitado','en_conflicto','sin_autorizacion','retirado')`,
    ),
  ],
);

export const partidos = pgTable(
  "partidos",
  {
    id: uuid("id").primaryKey(),
    torneoId: uuid("torneo_id")
      .notNull()
      .references(() => torneos.id),
    fase: text("fase", { enum: ["grupos", "liguilla", "eliminatoria"] }).notNull(),
    jornada: integer("jornada"),
    grupoId: uuid("grupo_id").references(() => grupos.id),
    inscripcionLocalId: uuid("inscripcion_local_id")
      .notNull()
      .references(() => inscripciones.id),
    inscripcionVisitanteId: uuid("inscripcion_visitante_id")
      .notNull()
      .references(() => inscripciones.id),
    /** Nulo mientras el partido no tenga fecha asignada. */
    fechaHora: ts("fecha_hora"),
    cancha: text("cancha"),
    estado: text("estado", {
      enum: ["programado", "en_juego", "finalizado", "aplazado", "cancelado"],
    })
      .notNull()
      .default("programado"),
    golesLocal: integer("goles_local"),
    golesVisitante: integer("goles_visitante"),
    registradoPor: uuid("registrado_por"),
    version: integer("version").notNull().default(1),
    creadoEn: ts("creado_en").notNull().defaultNow(),
    actualizadoEn: ts("actualizado_en").notNull().defaultNow(),
  },
  (t) => [
    index("partidos_torneo_idx").on(t.torneoId),
    check(
      "partidos_equipos_distintos_chk",
      sql`${t.inscripcionLocalId} <> ${t.inscripcionVisitanteId}`,
    ),
    check(
      "partidos_goles_chk",
      sql`(${t.golesLocal} is null or ${t.golesLocal} >= 0) and (${t.golesVisitante} is null or ${t.golesVisitante} >= 0)`,
    ),
    check(
      "partidos_estado_chk",
      sql`${t.estado} in ('programado','en_juego','finalizado','aplazado','cancelado')`,
    ),
  ],
);

export const eventosPartido = pgTable(
  "eventos_partido",
  {
    id: uuid("id").primaryKey(),
    partidoId: uuid("partido_id")
      .notNull()
      .references(() => partidos.id),
    tipo: text("tipo", { enum: ["gol", "autogol", "asistencia", "amarilla", "roja"] }).notNull(),
    jugadorId: uuid("jugador_id").notNull(),
    inscripcionId: uuid("inscripcion_id")
      .notNull()
      .references(() => inscripciones.id),
    minuto: integer("minuto").notNull(),
    registradoPor: uuid("registrado_por").notNull(),
    creadoEn: ts("creado_en").notNull().defaultNow(),
  },
  (t) => [
    index("eventos_partido_partido_idx").on(t.partidoId),
    index("eventos_partido_jugador_idx").on(t.jugadorId),
    check("eventos_partido_minuto_chk", sql`${t.minuto} between 0 and 130`),
    check(
      "eventos_partido_tipo_chk",
      sql`${t.tipo} in ('gol','autogol','asistencia','amarilla','roja')`,
    ),
  ],
);

export const posiciones = pgTable(
  "posiciones",
  {
    torneoId: uuid("torneo_id")
      .notNull()
      .references(() => torneos.id),
    /** Nulo en formato liguilla (tabla única) o para equipos aún sin grupo. */
    grupoId: uuid("grupo_id").references(() => grupos.id),
    inscripcionId: uuid("inscripcion_id")
      .notNull()
      .references(() => inscripciones.id),
    posicion: integer("posicion").notNull(),
    pj: integer("pj").notNull(),
    pg: integer("pg").notNull(),
    pe: integer("pe").notNull(),
    pp: integer("pp").notNull(),
    gf: integer("gf").notNull(),
    gc: integer("gc").notNull(),
    dg: integer("dg").notNull(),
    puntos: integer("puntos").notNull(),
    actualizadoEn: ts("actualizado_en").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.torneoId, t.inscripcionId] })],
);

// ---- Copias mínimas de otros servicios (solo cambian al recibir eventos) ----
export const copiaUsuariosAdmin = pgTable("copia_usuarios_admin", {
  usuarioId: uuid("usuario_id").primaryKey(),
  correo: text("correo").notNull(),
  nombre: text("nombre").notNull(),
  activo: boolean("activo").notNull().default(true),
});

export const copiaEquipos = pgTable("copia_equipos", {
  equipoId: uuid("equipo_id").primaryKey(),
  nombre: text("nombre").notNull(),
  municipio: text("municipio"),
  escudoUrl: text("escudo_url"),
  delegadoId: uuid("delegado_id").notNull(),
  eliminado: boolean("eliminado").notNull().default(false),
  version: integer("version").notNull().default(0),
});

export const copiaJugadores = pgTable(
  "copia_jugadores",
  {
    jugadorId: uuid("jugador_id").primaryKey(),
    equipoId: uuid("equipo_id").notNull(),
    nombreCompleto: text("nombre_completo").notNull(),
    dorsal: integer("dorsal"),
    posicion: text("posicion"),
    documentoHash: text("documento_hash").notNull(),
    /** Falso para un menor sin autorización del acudiente. */
    habilitado: boolean("habilitado").notNull().default(true),
    eliminado: boolean("eliminado").notNull().default(false),
    version: integer("version").notNull().default(0),
  },
  (t) => [index("copia_jugadores_equipo_idx").on(t.equipoId)],
);

export const auditoriaTorneos = pgTable("auditoria_torneos", {
  id: uuid("id").primaryKey(),
  torneoId: uuid("torneo_id"),
  usuarioId: uuid("usuario_id"),
  accion: text("accion").notNull(),
  detalle: jsonb("detalle"),
  creadoEn: ts("creado_en").notNull().defaultNow(),
});

export const eventosSalida = pgTable(
  "eventos_salida",
  {
    id: uuid("id").primaryKey(),
    tipo: text("tipo").notNull(),
    payload: jsonb("payload").notNull(),
    creadoEn: ts("creado_en").notNull().defaultNow(),
    publicadoEn: ts("publicado_en"),
  },
  (t) => [index("eventos_salida_pendientes_idx").on(t.publicadoEn)],
);

export const eventosProcesados = pgTable("eventos_procesados", {
  eventoId: uuid("evento_id").primaryKey(),
  procesadoEn: ts("procesado_en").notNull().defaultNow(),
});
