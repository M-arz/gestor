import { loadConfig } from "@gestor/shared";
import { z } from "zod";

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env) {
  return loadConfig(
    {
      JWT_SECRET: z.string().min(32),
      AUTH_URL: z.string().url(),
      CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000"),
      TRUST_PROXY: z
        .enum(["true", "false"])
        .default("false")
        .transform((v) => v === "true"),
      RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),
      AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
    },
    env,
  );
}
export type GatewayConfig = ReturnType<typeof loadGatewayConfig>;
