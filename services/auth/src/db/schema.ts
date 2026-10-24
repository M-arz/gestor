import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const usuarios = pgTable(
  "usuarios",
  {
    id: uuid("id").primaryKey(),
    correo: text("correo").notNull(),
    nombre: text("nombre").notNull(),
    contrasenaHash: text("contrasena_hash").notNull(),
    rol: text("rol", { enum: ["admin", "delegado"] }).notNull(),
    estado: text("estado", { enum: ["activo", "bloqueado", "desactivado"] })
      .notNull()
      .default("activo"),
    intentosFallidos: integer("intentos_fallidos").notNull().default(0),
    bloqueadoHasta: ts("bloqueado_hasta"),
    creadoEn: ts("creado_en").notNull().defaultNow(),
    actualizadoEn: ts("actualizado_en").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("usuarios_correo_unico").on(sql`lower(${t.correo})`),
    check("usuarios_rol_chk", sql`${t.rol} in ('admin','delegado')`),
    check("usuarios_estado_chk", sql`${t.estado} in ('activo','bloqueado','desactivado')`),
  ],
);

export const sesiones = pgTable(
  "sesiones",
  {
    id: uuid("id").primaryKey(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    tokenHash: text("token_hash").notNull().unique(),
    familiaId: uuid("familia_id").notNull(),
    expiraEn: ts("expira_en").notNull(),
    revocadoEn: ts("revocado_en"),
    reemplazadoPor: uuid("reemplazado_por"),
    agenteUsuario: text("agente_usuario"),
    ipHash: text("ip_hash"),
    creadoEn: ts("creado_en").notNull().defaultNow(),
  },
  (t) => [
    index("sesiones_familia_idx").on(t.familiaId),
    index("sesiones_usuario_idx").on(t.usuarioId),
  ],
);

export const recuperacionesContrasena = pgTable("recuperaciones_contrasena", {
  id: uuid("id").primaryKey(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiraEn: ts("expira_en").notNull(),
  usadoEn: ts("usado_en"),
  creadoEn: ts("creado_en").notNull().defaultNow(),
});

export const codigosAccesoAdmin = pgTable("codigos_acceso_admin", {
  id: uuid("id").primaryKey(),
  codigoHash: text("codigo_hash").notNull(),
  correoDestino: text("correo_destino"),
  expiraEn: ts("expira_en").notNull(),
  usadoEn: ts("usado_en"),
  usadoPor: uuid("usado_por"),
  creadoPor: text("creado_por").notNull(),
  intentosFallidos: integer("intentos_fallidos").notNull().default(0),
  creadoEn: ts("creado_en").notNull().defaultNow(),
});

export const consentimientos = pgTable("consentimientos", {
  id: uuid("id").primaryKey(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id),
  versionPolitica: text("version_politica").notNull(),
  aceptadoEn: ts("aceptado_en").notNull().defaultNow(),
  ipHash: text("ip_hash"),
});

export const auditoriaAuth = pgTable("auditoria_auth", {
  id: uuid("id").primaryKey(),
  usuarioId: uuid("usuario_id").references(() => usuarios.id),
  accion: text("accion").notNull(),
  detalle: jsonb("detalle"),
  ipHash: text("ip_hash"),
  creadoEn: ts("creado_en").notNull().defaultNow(),
});

/** Outbox: el evento se guarda en la misma transacción; otro proceso lo publica. */
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



export const solicitudesAdmin = pgTable(
  "solicitudes_admin",
  {
    id: uuid("id").primaryKey(),
    correo: text("correo").notNull(),
    nombre: text("nombre").notNull(),
    contrasenaHash: text("contrasena_hash").notNull(),
    versionPolitica: text("version_politica").notNull(),
    ipHash: text("ip_hash"),
    expiraEn: ts("expira_en").notNull(),
    completadaEn: ts("completada_en"),
    creadoEn: ts("creado_en").notNull().defaultNow(),
  },
  (t) => [
    index("solicitudes_admin_correo_idx").on(t.correo),
    index("solicitudes_admin_pendientes_idx").on(t.expiraEn, t.completadaEn),
  ],
);
