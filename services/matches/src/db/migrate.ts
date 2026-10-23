// Aplica las migraciones. En producción se ejecuta como paso aparte, antes de desplegar.
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");
const { db, pool } = createDb(url);
await migrate(db, { migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)) });
await pool.end();
console.log("Migraciones aplicadas");
