import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "./schema.js";

/** Tipo común a node-postgres (producción) y PGlite (pruebas). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
