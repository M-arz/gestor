import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const b64 = (b: Buffer) => b.toString("base64url");

/**
 * Protección del número de documento:
 *  - cifrar/descifrar: AES-256-GCM (confidencialidad e integridad), con prefijo de versión
 *    para poder rotar la clave en el futuro;
 *  - hash: HMAC-SHA256 con otra clave, para detectar repetidos sin descifrar.
 */
export function crearCifrador(claveBase64: string, claveHash: string) {
  const key = Buffer.from(claveBase64, "base64");
  if (key.length !== 32) throw new Error("La clave de cifrado debe tener 32 bytes");

  /** "1.234.567" y "1234567" son el mismo documento. */
  const normalizar = (tipo: string, numero: string) =>
    `${tipo}:${numero.replace(/[\s.\-]/g, "").toUpperCase()}`;

  return {
    cifrar(texto: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(texto, "utf8"), c.final()]);
      return ["v1", b64(iv), b64(c.getAuthTag()), b64(ct)].join(".");
    },
    descifrar(valor: string): string {
      const [v, iv, tag, ct] = valor.split(".");
      if (v !== "v1" || !iv || !tag || !ct)
        throw new Error("Formato de documento cifrado inválido");
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
    },
    hash: (tipo: string, numero: string) =>
      createHmac("sha256", claveHash).update(normalizar(tipo, numero)).digest("hex"),
    normalizar,
  };
}
export type Cifrador = ReturnType<typeof crearCifrador>;

/** Muestra solo los últimos 3 caracteres: ******567 */
export const enmascarar = (numero: string) =>
  "*".repeat(Math.max(0, numero.length - 3)) + numero.slice(-3);
