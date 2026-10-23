import { startService } from "@gestor/shared";
import { buildApp } from "./app.js";
import { loadGatewayConfig } from "./config.js";

const c = loadGatewayConfig();
const app = await buildApp({
  logLevel: c.LOG_LEVEL,
  jwtSecret: c.JWT_SECRET,
  authUrl: c.AUTH_URL,
  teamsUrl: c.TEAMS_URL,
  matchesUrl: c.MATCHES_URL,
  corsOrigins: c.CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  trustProxy: c.TRUST_PROXY,
  generalLimitPerMin: c.RATE_LIMIT_PER_MIN,
  authLimitPerMin: c.AUTH_RATE_LIMIT_PER_MIN,
});
await startService(app, c.PORT);
