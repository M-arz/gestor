import { z } from "zod";

/** Variables que todo servicio entiende. Cada servicio puede añadir las suyas. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
});

/** Valida el entorno al arrancar. Si falta algo, el servicio no inicia. */
export function loadConfig<T extends z.ZodRawShape>(
  extra: T = {} as T,
  env: NodeJS.ProcessEnv = process.env,
) {
  const result = baseEnvSchema.extend(extra).safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Configuración inválida:\n${lines.join("\n")}`);
  }
  // Un secreto de desarrollo nunca debe llegar a producción.
  if (result.data.NODE_ENV === "production") {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === "string" && v.includes("dev-only")) {
        throw new Error(`Configuración inválida: ${k} usa un valor de desarrollo en producción`);
      }
    }
  }
  return result.data;
}
