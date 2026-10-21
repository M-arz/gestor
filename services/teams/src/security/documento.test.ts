import { describe, expect, it } from "vitest";
import { CLAVE_DOCUMENTO_DESARROLLO } from "../config.js";
import { detectarImagen } from "../storage/imagen.js";
import { crearCifrador, enmascarar } from "./documento.js";

const c = crearCifrador(CLAVE_DOCUMENTO_DESARROLLO, "h".repeat(40));

describe("cifrado del documento", () => {
  it("cifra y descifra, y cada cifrado es distinto", () => {
    const a = c.cifrar("1234567");
    expect(a).not.toContain("1234567");
    expect(c.descifrar(a)).toBe("1234567");
    expect(c.cifrar("1234567")).not.toBe(a);
  });
  it("detecta manipulación y clave equivocada", () => {
    const a = c.cifrar("1234567");
    const partes = a.split(".");
    partes[3] = Buffer.from("otra-cosa").toString("base64url");
    expect(() => c.descifrar(partes.join("."))).toThrow();
    const otra = crearCifrador(Buffer.alloc(32, 7).toString("base64"), "h".repeat(40));
    expect(() => otra.descifrar(a)).toThrow();
  });
  it("el hash ignora puntos, espacios y mayúsculas, pero distingue el tipo", () => {
    expect(c.hash("CC", "1.234.567")).toBe(c.hash("CC", "1234567"));
    expect(c.hash("PA", "ab 123")).toBe(c.hash("PA", "AB123"));
    expect(c.hash("CC", "1234567")).not.toBe(c.hash("TI", "1234567"));
    expect(c.hash("CC", "1234567")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("el hash depende de la clave secreta", () => {
    const otra = crearCifrador(CLAVE_DOCUMENTO_DESARROLLO, "z".repeat(40));
    expect(otra.hash("CC", "1234567")).not.toBe(c.hash("CC", "1234567"));
  });
  it("enmascara dejando solo los últimos 3", () => {
    expect(enmascarar("1234567")).toBe("****567");
  });
});

describe("detección de imágenes", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  it("reconoce PNG, JPEG y WebP por su contenido", () => {
    expect(detectarImagen(png)?.ext).toBe("png");
    expect(
      detectarImagen(
        Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
          Buffer.alloc(20),
          Buffer.from([0xff, 0xd9]),
        ]),
      )?.ext,
    ).toBe("jpg");
    expect(
      detectarImagen(
        Buffer.concat([
          Buffer.from("RIFF"),
          Buffer.alloc(4),
          Buffer.from("WEBPVP8 "),
          Buffer.alloc(10),
        ]),
      )?.ext,
    ).toBe("webp");
  });
  it("rechaza SVG, HTML, texto y archivos vacíos", () => {
    expect(
      detectarImagen(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      ),
    ).toBeNull();
    expect(detectarImagen(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectarImagen(Buffer.from("GIF89a....................."))).toBeNull();
    expect(detectarImagen(Buffer.alloc(0))).toBeNull();
  });
});
