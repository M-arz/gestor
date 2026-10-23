import { loadConfig } from "@gestor/shared";
import { z } from "zod";

export function loadMatchesConfig(env: NodeJS.ProcessEnv = process.env) {
  return loadConfig({ DATABASE_URL: z.string().url(), JWT_SECRET: z.string().min(32) }, env);
}
export type MatchesConfig = ReturnType<typeof loadMatchesConfig>;
