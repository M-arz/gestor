// Genera un código de acceso de administrador (un solo uso, con vencimiento).
// Uso: pnpm codigo-admin --correo persona@dominio.com --dias 7
import { createDb } from "../db/client.js";
import { crearCodigoAdmin } from "../services/auth.service.js";

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");
const dias = Number(arg("dias") ?? "7");
if (!Number.isInteger(dias) || dias < 1 || dias > 30)
  throw new Error("--dias debe estar entre 1 y 30");

const { db, pool } = createDb(url);
const { codigo, expiraEn } = await crearCodigoAdmin(db, {
  correoDestino: arg("correo"),
  diasVigencia: dias,
});
await pool.end();

console.log("\nCódigo de acceso de administrador (se muestra UNA sola vez):\n");
console.log(`  ${codigo}\n`);
console.log(`Vence: ${expiraEn.toISOString()}`);
console.log(arg("correo") ? `Solo sirve para: ${arg("correo")}` : "Sirve para cualquier correo.");
