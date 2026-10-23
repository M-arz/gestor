import { createLogger, createServiceApp } from "@gestor/shared";

export const SERVICE_NAME = "discipline-service";

export async function buildApp(logLevel = "info") {
  const logger = createLogger(SERVICE_NAME, logLevel);
  const app = await createServiceApp({
    name: SERVICE_NAME,
    logger,
    trustProxy: true,
  });
  return app;
}