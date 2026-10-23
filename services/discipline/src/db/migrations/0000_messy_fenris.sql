CREATE TABLE "acumulados_jugador" (
	"id" serial PRIMARY KEY NOT NULL,
	"torneo_id" text NOT NULL,
	"jugador_id" text NOT NULL,
	"amarillas_acumuladas" integer DEFAULT 0 NOT NULL,
	"actualizado_en" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditoria_disciplina" (
	"id" serial PRIMARY KEY NOT NULL,
	"torneo_id" text NOT NULL,
	"usuario_id" text,
	"accion" text NOT NULL,
	"detalle" text,
	"creado_en" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copia_administradores_torneo" (
	"torneo_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copia_equipos" (
	"equipo_id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"municipio" text,
	"escudo_url" text,
	"delegado_id" text,
	"eliminado" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copia_jugadores" (
	"jugador_id" text PRIMARY KEY NOT NULL,
	"equipo_id" text NOT NULL,
	"nombre_completo" text NOT NULL,
	"dorsal" integer,
	"posicion" text,
	"documento_hash" text,
	"activo" boolean DEFAULT true NOT NULL,
	"eliminado" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copia_torneos" (
	"torneo_id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"estado" text DEFAULT 'activo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multas" (
	"id" serial PRIMARY KEY NOT NULL,
	"torneo_id" text NOT NULL,
	"concepto" text NOT NULL,
	"monto" integer NOT NULL,
	"tarjeta_id" text,
	"jugador_id" text NOT NULL,
	"equipo_id" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"registrada_por" text NOT NULL,
	"creado_en" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reglamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"torneo_id" text NOT NULL,
	"amarillas_para_suspension" integer DEFAULT 3 NOT NULL,
	"partidos_suspension_por_roja" integer DEFAULT 1 NOT NULL,
	"valor_multa_amarilla" integer DEFAULT 10000 NOT NULL,
	"valor_multa_roja" integer DEFAULT 25000 NOT NULL,
	"vigente_desde" text,
	"creado_por" text NOT NULL,
	"creado_en" timestamp DEFAULT now() NOT NULL,
	"actualizado_en" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suspensiones" (
	"id" serial PRIMARY KEY NOT NULL,
	"torneo_id" text NOT NULL,
	"jugador_id" text NOT NULL,
	"motivo" text NOT NULL,
	"partidos_totales" integer NOT NULL,
	"partidos_cumplidos" integer DEFAULT 0 NOT NULL,
	"estado" text DEFAULT 'vigente' NOT NULL,
	"tarjeta_id" text,
	"creado_en" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tarjetas" (
	"id" serial PRIMARY KEY NOT NULL,
	"torneo_id" text NOT NULL,
	"partido_id" text NOT NULL,
	"jugador_id" text NOT NULL,
	"equipo_id" text NOT NULL,
	"tipo" text NOT NULL,
	"minuto" integer NOT NULL,
	"creado_en" timestamp DEFAULT now() NOT NULL
);
