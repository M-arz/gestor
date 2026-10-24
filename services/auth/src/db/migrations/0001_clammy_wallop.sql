CREATE TABLE "solicitudes_admin" (
	"id" uuid PRIMARY KEY NOT NULL,
	"correo" text NOT NULL,
	"nombre" text NOT NULL,
	"contrasena_hash" text NOT NULL,
	"version_politica" text NOT NULL,
	"ip_hash" text,
	"expira_en" timestamp with time zone NOT NULL,
	"completada_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "solicitudes_admin_correo_idx" ON "solicitudes_admin" USING btree ("correo");--> statement-breakpoint
CREATE INDEX "solicitudes_admin_pendientes_idx" ON "solicitudes_admin" USING btree ("expira_en","completada_en");