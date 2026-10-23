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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const equipos = pgTable(
  "equipos",
  {
    id: uuid("id").primaryKey(),
    nombre: text("nombre").notNull(),
    municipio: text("municipio").notNull(),
    /** Clave del archivo en el almacenamiento (no el contenido). */
    escudoUrl: text("escudo_url"),
    /** Id de usuario en auth-service (sin llave foránea: es otra base). */
    delegadoId: uuid("delegado_id").notNull(),
    estado: text("estado", { enum: ["activo", "sin_delegado"] })
      .notNull()
      .default("activo"),
    version: integer("version").notNull().default(1),
    creadoEn: ts("creado_en").notNull().defaultNow(),
    actualizadoEn: ts("actualizado_en").notNull().defaultNow(),
    eliminadoEn: ts("eliminado_en"),
  },
  (t) => [
    uniqueIndex("equipos_delegado_nombre_unico")
      .on(t.delegadoId, sql`lower(${t.nombre})`)
      .where(sql`${t.eliminadoEn} is null`),
    index("equipos_delegado_idx").on(t.delegadoId),
    check("equipos_estado_chk", sql`${t.estado} in ('activo','sin_delegado')`),
  ],
);

export const jugadores = pgTable(
  "jugadores",
  {
    id: uuid("id").primaryKey(),
    equipoId: uuid("equipo_id")
      .notNull()
      .references(() => equipos.id),
    nombres: text("nombres").notNull(),
    apellidos: text("apellidos").notNull(),
    tipoDocumento: text("tipo_documento").notNull(),
    /** AES-256-GCM. El número nunca se guarda en claro. */
    documentoCifrado: text("documento_cifrado").notNull(),
    /** HMAC con clave secreta: detecta repetidos sin descifrar. */
    documentoHash: text("documento_hash").notNull(),
    /** Nulo solo cuando el jugador fue anonimizado. */
    fechaNacimiento: date("fecha_nacimiento", { mode: "string" }),
    dorsal: integer("dorsal").notNull(),
    posicion: text("posicion").notNull(),
    fotoUrl: text("foto_url"),
    autorizacionAcudiente: boolean("autorizacion_acudiente").notNull().default(false),
    autorizacionAcudienteEn: ts("autorizacion_acudiente_en"),
    autorizacionRegistradaPor: uuid("autorizacion_registrada_por"),
    version: integer("version").notNull().default(1),
    creadoEn: ts("creado_en").notNull().defaultNow(),
    actualizadoEn: ts("actualizado_en").notNull().defaultNow(),
    eliminadoEn: ts("eliminado_en"),
  },
  (t) => [
    uniqueIndex("jugadores_equipo_documento_unico")
      .on(t.equipoId, t.documentoHash)
      .where(sql`${t.eliminadoEn} is null`),
    uniqueIndex("jugadores_equipo_dorsal_unico")
      .on(t.equipoId, t.dorsal)
      .where(sql`${t.eliminadoEn} is null`),
    index("jugadores_equipo_idx").on(t.equipoId),
    check("jugadores_dorsal_chk", sql`${t.dorsal} between 0 and 99`),
    check(
      "jugadores_posicion_chk",
      sql`${t.posicion} in ('portero','defensa','mediocampista','delantero')`,
    ),
    check(
      "jugadores_tipo_documento_chk",
      sql`${t.tipoDocumento} in ('RC','TI','CC','CE','PPT','PEP','PA')`,
    ),
  ],
);

// Copias mínimas de matches-service, para decidir permisos sin llamarlo.
// Solo cambian al recibir eventos (fase 4).
export const copiaTorneos = pgTable("copia_torneos", {
  torneoId: uuid("torneo_id").primaryKey(),
  nombre: text("nombre").notNull(),
  estado: text("estado").notNull(),
  version: integer("version").notNull().default(0),
});

export const copiaInscripciones = pgTable(
  "copia_inscripciones",
  {
    equipoId: uuid("equipo_id").notNull(),
    torneoId: uuid("torneo_id").notNull(),
    estado: text("estado").notNull(),
    version: integer("version").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.equipoId, t.torneoId] })],
);

export const copiaAdministradoresTorneo = pgTable(
  "copia_administradores_torneo",
  {
    torneoId: uuid("torneo_id").notNull(),
    usuarioId: uuid("usuario_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.torneoId, t.usuarioId] })],
);

export const auditoriaTeams = pgTable("auditoria_teams", {
  id: uuid("id").primaryKey(),
  usuarioId: uuid("usuario_id"),
  equipoId: uuid("equipo_id"),
  jugadorId: uuid("jugador_id"),
  accion: text("accion").notNull(),
  /** Nunca contiene datos personales: solo identificadores. */
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
