import { z } from "zod";

/** Variables que todo servicio entiende. Cada servicio puede añadir las suyas. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
});

type ConfigOutput<T extends z.ZodRawShape> = z.output<typeof baseEnvSchema> & {
  [K in keyof T]: z.output<T[K]>;
};

/** Valida el entorno al arrancar. Si falta algo, el servicio no inicia. */
export function loadConfig<T extends z.ZodRawShape>(
  extra: T = {} as T,
  env: NodeJS.ProcessEnv = process.env,
): ConfigOutput<T> {
  const baseResult = baseEnvSchema.safeParse(env);
  const extraResult = z.object(extra).safeParse(env);
  if (!baseResult.success || !extraResult.success) {
    const issues = [
      ...(baseResult.success ? [] : baseResult.error.issues),
      ...(extraResult.success ? [] : extraResult.error.issues),
    ];
    const lines = issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Configuración inválida:\n${lines.join("\n")}`);
  }
  const config = Object.assign(baseResult.data, extraResult.data) as ConfigOutput<T>;
  // Un secreto de desarrollo nunca debe llegar a producción.
  if (config.NODE_ENV === "production") {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === "string" && v.includes("dev-only")) {
        throw new Error(`Configuración inválida: ${k} usa un valor de desarrollo en producción`);
      }
    }
  }
  return config;
}
