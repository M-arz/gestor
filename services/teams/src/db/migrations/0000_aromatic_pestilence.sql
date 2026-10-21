CREATE TABLE "auditoria_teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"usuario_id" uuid,
	"equipo_id" uuid,
	"jugador_id" uuid,
	"accion" text NOT NULL,
	"detalle" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copia_administradores_torneo" (
	"torneo_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	CONSTRAINT "copia_administradores_torneo_torneo_id_usuario_id_pk" PRIMARY KEY("torneo_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "copia_inscripciones" (
	"equipo_id" uuid NOT NULL,
	"torneo_id" uuid NOT NULL,
	"estado" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "copia_inscripciones_equipo_id_torneo_id_pk" PRIMARY KEY("equipo_id","torneo_id")
);
--> statement-breakpoint
CREATE TABLE "copia_torneos" (
	"torneo_id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"estado" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"municipio" text NOT NULL,
	"escudo_url" text,
	"delegado_id" uuid NOT NULL,
	"estado" text DEFAULT 'activo' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"eliminado_en" timestamp with time zone,
	CONSTRAINT "equipos_estado_chk" CHECK ("equipos"."estado" in ('activo','sin_delegado'))
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
CREATE TABLE "jugadores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"equipo_id" uuid NOT NULL,
	"nombres" text NOT NULL,
	"apellidos" text NOT NULL,
	"tipo_documento" text NOT NULL,
	"documento_cifrado" text NOT NULL,
	"documento_hash" text NOT NULL,
	"fecha_nacimiento" date,
	"dorsal" integer NOT NULL,
	"posicion" text NOT NULL,
	"foto_url" text,
	"autorizacion_acudiente" boolean DEFAULT false NOT NULL,
	"autorizacion_acudiente_en" timestamp with time zone,
	"autorizacion_registrada_por" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"eliminado_en" timestamp with time zone,
	CONSTRAINT "jugadores_dorsal_chk" CHECK ("jugadores"."dorsal" between 0 and 99),
	CONSTRAINT "jugadores_posicion_chk" CHECK ("jugadores"."posicion" in ('portero','defensa','mediocampista','delantero')),
	CONSTRAINT "jugadores_tipo_documento_chk" CHECK ("jugadores"."tipo_documento" in ('RC','TI','CC','CE','PPT','PEP','PA'))
);
--> statement-breakpoint
ALTER TABLE "jugadores" ADD CONSTRAINT "jugadores_equipo_id_equipos_id_fk" FOREIGN KEY ("equipo_id") REFERENCES "public"."equipos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipos_delegado_nombre_unico" ON "equipos" USING btree ("delegado_id",lower("nombre")) WHERE "equipos"."eliminado_en" is null;--> statement-breakpoint
CREATE INDEX "equipos_delegado_idx" ON "equipos" USING btree ("delegado_id");--> statement-breakpoint
CREATE INDEX "eventos_salida_pendientes_idx" ON "eventos_salida" USING btree ("publicado_en");--> statement-breakpoint
CREATE UNIQUE INDEX "jugadores_equipo_documento_unico" ON "jugadores" USING btree ("equipo_id","documento_hash") WHERE "jugadores"."eliminado_en" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "jugadores_equipo_dorsal_unico" ON "jugadores" USING btree ("equipo_id","dorsal") WHERE "jugadores"."eliminado_en" is null;--> statement-breakpoint
CREATE INDEX "jugadores_equipo_idx" ON "jugadores" USING btree ("equipo_id");