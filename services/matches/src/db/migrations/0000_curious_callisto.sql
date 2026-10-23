CREATE TABLE "administradores_torneo" (
	"torneo_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"agregado_por" uuid NOT NULL,
	"agregado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"retirado_en" timestamp with time zone,
	CONSTRAINT "administradores_torneo_torneo_id_usuario_id_pk" PRIMARY KEY("torneo_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "auditoria_torneos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"torneo_id" uuid,
	"usuario_id" uuid,
	"accion" text NOT NULL,
	"detalle" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copia_equipos" (
	"equipo_id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"municipio" text,
	"escudo_url" text,
	"delegado_id" uuid NOT NULL,
	"eliminado" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copia_jugadores" (
	"jugador_id" uuid PRIMARY KEY NOT NULL,
	"equipo_id" uuid NOT NULL,
	"nombre_completo" text NOT NULL,
	"dorsal" integer,
	"posicion" text,
	"documento_hash" text NOT NULL,
	"habilitado" boolean DEFAULT true NOT NULL,
	"eliminado" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copia_usuarios_admin" (
	"usuario_id" uuid PRIMARY KEY NOT NULL,
	"correo" text NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eventos_partido" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partido_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"jugador_id" uuid NOT NULL,
	"inscripcion_id" uuid NOT NULL,
	"minuto" integer NOT NULL,
	"registrado_por" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eventos_partido_minuto_chk" CHECK ("eventos_partido"."minuto" between 0 and 130),
	CONSTRAINT "eventos_partido_tipo_chk" CHECK ("eventos_partido"."tipo" in ('gol','autogol','asistencia','amarilla','roja'))
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
CREATE TABLE "grupo_equipos" (
	"grupo_id" uuid NOT NULL,
	"inscripcion_id" uuid NOT NULL,
	CONSTRAINT "grupo_equipos_grupo_id_inscripcion_id_pk" PRIMARY KEY("grupo_id","inscripcion_id"),
	CONSTRAINT "grupo_equipos_inscripcion_unica" UNIQUE("inscripcion_id")
);
--> statement-breakpoint
CREATE TABLE "grupos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"torneo_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "grupos_torneo_nombre_unico" UNIQUE("torneo_id","nombre")
);
--> statement-breakpoint
CREATE TABLE "inscripciones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"torneo_id" uuid NOT NULL,
	"equipo_id" uuid NOT NULL,
	"solicitada_por" uuid NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"motivo_decision" text,
	"decidida_por" uuid,
	"decidida_en" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inscripciones_estado_chk" CHECK ("inscripciones"."estado" in ('pendiente','aceptada','rechazada','retirada'))
);
--> statement-breakpoint
CREATE TABLE "partidos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"torneo_id" uuid NOT NULL,
	"fase" text NOT NULL,
	"jornada" integer,
	"grupo_id" uuid,
	"inscripcion_local_id" uuid NOT NULL,
	"inscripcion_visitante_id" uuid NOT NULL,
	"fecha_hora" timestamp with time zone,
	"cancha" text,
	"estado" text DEFAULT 'programado' NOT NULL,
	"goles_local" integer,
	"goles_visitante" integer,
	"registrado_por" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partidos_equipos_distintos_chk" CHECK ("partidos"."inscripcion_local_id" <> "partidos"."inscripcion_visitante_id"),
	CONSTRAINT "partidos_goles_chk" CHECK (("partidos"."goles_local" is null or "partidos"."goles_local" >= 0) and ("partidos"."goles_visitante" is null or "partidos"."goles_visitante" >= 0)),
	CONSTRAINT "partidos_estado_chk" CHECK ("partidos"."estado" in ('programado','en_juego','finalizado','aplazado','cancelado'))
);
--> statement-breakpoint
CREATE TABLE "plantillas_torneo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"torneo_id" uuid NOT NULL,
	"inscripcion_id" uuid NOT NULL,
	"jugador_id" uuid NOT NULL,
	"documento_hash" text NOT NULL,
	"estado" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plantillas_inscripcion_jugador_unica" UNIQUE("inscripcion_id","jugador_id"),
	CONSTRAINT "plantillas_estado_chk" CHECK ("plantillas_torneo"."estado" in ('habilitado','en_conflicto','sin_autorizacion','retirado'))
);
--> statement-breakpoint
CREATE TABLE "posiciones" (
	"torneo_id" uuid NOT NULL,
	"grupo_id" uuid,
	"inscripcion_id" uuid NOT NULL,
	"posicion" integer NOT NULL,
	"pj" integer NOT NULL,
	"pg" integer NOT NULL,
	"pe" integer NOT NULL,
	"pp" integer NOT NULL,
	"gf" integer NOT NULL,
	"gc" integer NOT NULL,
	"dg" integer NOT NULL,
	"puntos" integer NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posiciones_torneo_id_inscripcion_id_pk" PRIMARY KEY("torneo_id","inscripcion_id")
);
--> statement-breakpoint
CREATE TABLE "torneos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text,
	"temporada" text NOT NULL,
	"formato" text NOT NULL,
	"estado" text DEFAULT 'borrador' NOT NULL,
	"fecha_inicio" date,
	"fecha_fin" date,
	"cupo_maximo_equipos" integer,
	"puntos_victoria" integer DEFAULT 3 NOT NULL,
	"puntos_empate" integer DEFAULT 1 NOT NULL,
	"puntos_derrota" integer DEFAULT 0 NOT NULL,
	"criterios_desempate" jsonb NOT NULL,
	"creado_por" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"archivado_en" timestamp with time zone,
	CONSTRAINT "torneos_formato_chk" CHECK ("torneos"."formato" in ('grupos','liguilla')),
	CONSTRAINT "torneos_estado_chk" CHECK ("torneos"."estado" in ('borrador','inscripciones_abiertas','en_juego','finalizado','archivado')),
	CONSTRAINT "torneos_cupo_chk" CHECK ("torneos"."cupo_maximo_equipos" is null or "torneos"."cupo_maximo_equipos" >= 2)
);
--> statement-breakpoint
ALTER TABLE "administradores_torneo" ADD CONSTRAINT "administradores_torneo_torneo_id_torneos_id_fk" FOREIGN KEY ("torneo_id") REFERENCES "public"."torneos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_partido" ADD CONSTRAINT "eventos_partido_partido_id_partidos_id_fk" FOREIGN KEY ("partido_id") REFERENCES "public"."partidos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_partido" ADD CONSTRAINT "eventos_partido_inscripcion_id_inscripciones_id_fk" FOREIGN KEY ("inscripcion_id") REFERENCES "public"."inscripciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grupo_equipos" ADD CONSTRAINT "grupo_equipos_grupo_id_grupos_id_fk" FOREIGN KEY ("grupo_id") REFERENCES "public"."grupos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grupo_equipos" ADD CONSTRAINT "grupo_equipos_inscripcion_id_inscripciones_id_fk" FOREIGN KEY ("inscripcion_id") REFERENCES "public"."inscripciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grupos" ADD CONSTRAINT "grupos_torneo_id_torneos_id_fk" FOREIGN KEY ("torneo_id") REFERENCES "public"."torneos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inscripciones" ADD CONSTRAINT "inscripciones_torneo_id_torneos_id_fk" FOREIGN KEY ("torneo_id") REFERENCES "public"."torneos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_torneo_id_torneos_id_fk" FOREIGN KEY ("torneo_id") REFERENCES "public"."torneos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_grupo_id_grupos_id_fk" FOREIGN KEY ("grupo_id") REFERENCES "public"."grupos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_inscripcion_local_id_inscripciones_id_fk" FOREIGN KEY ("inscripcion_local_id") REFERENCES "public"."inscripciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partidos" ADD CONSTRAINT "partidos_inscripcion_visitante_id_inscripciones_id_fk" FOREIGN KEY ("inscripcion_visitante_id") REFERENCES "public"."inscripciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantillas_torneo" ADD CONSTRAINT "plantillas_torneo_torneo_id_torneos_id_fk" FOREIGN KEY ("torneo_id") REFERENCES "public"."torneos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantillas_torneo" ADD CONSTRAINT "plantillas_torneo_inscripcion_id_inscripciones_id_fk" FOREIGN KEY ("inscripcion_id") REFERENCES "public"."inscripciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posiciones" ADD CONSTRAINT "posiciones_torneo_id_torneos_id_fk" FOREIGN KEY ("torneo_id") REFERENCES "public"."torneos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posiciones" ADD CONSTRAINT "posiciones_grupo_id_grupos_id_fk" FOREIGN KEY ("grupo_id") REFERENCES "public"."grupos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posiciones" ADD CONSTRAINT "posiciones_inscripcion_id_inscripciones_id_fk" FOREIGN KEY ("inscripcion_id") REFERENCES "public"."inscripciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copia_jugadores_equipo_idx" ON "copia_jugadores" USING btree ("equipo_id");--> statement-breakpoint
CREATE INDEX "eventos_partido_partido_idx" ON "eventos_partido" USING btree ("partido_id");--> statement-breakpoint
CREATE INDEX "eventos_partido_jugador_idx" ON "eventos_partido" USING btree ("jugador_id");--> statement-breakpoint
CREATE INDEX "eventos_salida_pendientes_idx" ON "eventos_salida" USING btree ("publicado_en");--> statement-breakpoint
CREATE UNIQUE INDEX "inscripciones_equipo_torneo_unica" ON "inscripciones" USING btree ("torneo_id","equipo_id") WHERE "inscripciones"."estado" in ('pendiente','aceptada');--> statement-breakpoint
CREATE INDEX "inscripciones_torneo_idx" ON "inscripciones" USING btree ("torneo_id");--> statement-breakpoint
CREATE INDEX "inscripciones_equipo_idx" ON "inscripciones" USING btree ("equipo_id");--> statement-breakpoint
CREATE INDEX "partidos_torneo_idx" ON "partidos" USING btree ("torneo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plantillas_documento_habilitado_unico" ON "plantillas_torneo" USING btree ("torneo_id","documento_hash") WHERE "plantillas_torneo"."estado" = 'habilitado';--> statement-breakpoint
CREATE INDEX "plantillas_jugador_idx" ON "plantillas_torneo" USING btree ("jugador_id");