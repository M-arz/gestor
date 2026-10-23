import { loadConfig } from "@gestor/shared";
import { z } from "zod";

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  return loadConfig(
    {
      DATABASE_URL: z.string().url(),
      JWT_SECRET: z.string().min(32),
      IP_HASH_SECRET: z.string().min(16),
      POLICY_VERSION: z.string().default("1.0"),
      ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),
      REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
    },
    env,
  );
}
export type AuthConfig = ReturnType<typeof loadAuthConfig>;
