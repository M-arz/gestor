export interface TipoImagen {
  ext: "png" | "jpg" | "webp";
  mime: "image/png" | "image/jpeg" | "image/webp";
}

/**
 * Detecta el tipo REAL por el contenido, sin fiarse del nombre ni del Content-Type
 * que declare el cliente. Se aceptan solo PNG, JPEG y WebP (SVG queda fuera a propósito:
 * puede contener scripts).
 */
export function detectarImagen(b: Buffer): TipoImagen | null {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (
    b.length > 24 &&
    b.subarray(0, 8).equals(png) &&
    b.subarray(12, 16).toString("ascii") === "IHDR"
  ) {
    return { ext: "png", mime: "image/png" };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let fin = b.length;
    while (fin > 2 && b[fin - 1] === 0) fin--; // algunos archivos terminan con ceros de relleno
    if (b[fin - 2] === 0xff && b[fin - 1] === 0xd9) return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    b.length > 16 &&
    b.subarray(0, 4).toString("ascii") === "RIFF" &&
    b.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export const MIME_POR_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};
