CREATE TABLE "auditoria_auth" (
	"id" uuid PRIMARY KEY NOT NULL,
	"usuario_id" uuid,
	"accion" text NOT NULL,
	"detalle" jsonb,
	"ip_hash" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codigos_acceso_admin" (
	"id" uuid PRIMARY KEY NOT NULL,
	"codigo_hash" text NOT NULL,
	"correo_destino" text,
	"expira_en" timestamp with time zone NOT NULL,
	"usado_en" timestamp with time zone,
	"usado_por" uuid,
	"creado_por" text NOT NULL,
	"intentos_fallidos" integer DEFAULT 0 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consentimientos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"usuario_id" uuid NOT NULL,
	"version_politica" text NOT NULL,
	"aceptado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "eventos_procesados" (
	"evento_id" uuid PRIMARY KEY NOT NULL,
	"procesado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eventos_salida" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"payload" jsonb NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"publicado_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recuperaciones_contrasena" (
	"id" uuid PRIMARY KEY NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"usado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recuperaciones_contrasena_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"familia_id" uuid NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"revocado_en" timestamp with time zone,
	"reemplazado_por" uuid,
	"agente_usuario" text,
	"ip_hash" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sesiones_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"correo" text NOT NULL,
	"nombre" text NOT NULL,
	"contrasena_hash" text NOT NULL,
	"rol" text NOT NULL,
	"estado" text DEFAULT 'activo' NOT NULL,
	"intentos_fallidos" integer DEFAULT 0 NOT NULL,
	"bloqueado_hasta" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_rol_chk" CHECK ("usuarios"."rol" in ('admin','delegado')),
	CONSTRAINT "usuarios_estado_chk" CHECK ("usuarios"."estado" in ('activo','bloqueado','desactivado'))
);
--> statement-breakpoint
ALTER TABLE "auditoria_auth" ADD CONSTRAINT "auditoria_auth_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recuperaciones_contrasena" ADD CONSTRAINT "recuperaciones_contrasena_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eventos_salida_pendientes_idx" ON "eventos_salida" USING btree ("publicado_en");--> statement-breakpoint
CREATE INDEX "sesiones_familia_idx" ON "sesiones" USING btree ("familia_id");--> statement-breakpoint
CREATE INDEX "sesiones_usuario_idx" ON "sesiones" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_correo_unico" ON "usuarios" USING btree (lower("correo"));