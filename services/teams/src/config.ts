import { loadConfig } from "@gestor/shared";
import { z } from "zod";

/** Clave de desarrollo (base64 de 32 bytes). Se rechaza en producción. */
export const CLAVE_DOCUMENTO_DESARROLLO = "ZGV2LW9ubHktZG9jdW1lbnRvLWtleS0zMi1ieXRlcyE=";

export function loadTeamsConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = loadConfig(
    {
      DATABASE_URL: z.string().url(),
      JWT_SECRET: z.string().min(32),
      DOCUMENTO_CLAVE: z
        .string()
        .refine(
          (v) => Buffer.from(v, "base64").length === 32,
          "Debe ser una clave de 32 bytes en base64",
        ),
      DOCUMENTO_HASH_CLAVE: z.string().min(32),
      STORAGE_DIR: z.string().default("/data/archivos"),
      MAX_UPLOAD_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .default(2 * 1024 * 1024),
    },
    env,
  );
  if (c.NODE_ENV === "production" && c.DOCUMENTO_CLAVE === CLAVE_DOCUMENTO_DESARROLLO) {
    throw new Error("Configuración inválida: DOCUMENTO_CLAVE es la de desarrollo");
  }
  return c;
}
export type TeamsConfig = ReturnType<typeof loadTeamsConfig>;
