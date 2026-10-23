import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/** Argon2id con los parámetros por defecto de la librería (recomendación OWASP). */
export const hashPassword = (password: string) => hash(password);

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** Token aleatorio de 256 bits. Solo se guarda su hash. */
export const randomToken = () => randomBytes(32).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** La IP nunca se guarda en claro: HMAC con secreto del servidor. */
export const hashIp = (ip: string | undefined, secret: string) =>
  ip ? createHmac("sha256", secret).update(ip).digest("hex") : null;
