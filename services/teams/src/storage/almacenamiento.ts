import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Interfaz común de almacenamiento. En local se usa el disco; en producción se añadirá un
 * driver S3-compatible (p. ej. Cloudflare R2) sin tocar el resto del código.
 */
export interface Almacenamiento {
  guardar(clave: string, datos: Buffer): Promise<void>;
  leer(clave: string): Promise<Buffer | null>;
  borrar(clave: string): Promise<void>;
}

const CLAVE_VALIDA = /^(escudos|fotos)\/[0-9a-f-]{36}\.(png|jpg|webp)$/;

export class AlmacenamientoLocal implements Almacenamiento {
  private readonly raiz: string;
  constructor(dir: string) {
    this.raiz = resolve(dir);
  }
  /** Rechaza cualquier clave que no sea la que generamos (evita "../" y rutas absolutas). */
  private ruta(clave: string): string {
    if (!CLAVE_VALIDA.test(clave)) throw new Error("Clave de archivo inválida");
    const r = resolve(join(this.raiz, clave));
    if (!r.startsWith(this.raiz + sep)) throw new Error("Clave de archivo inválida");
    return r;
  }
  async guardar(clave: string, datos: Buffer) {
    const r = this.ruta(clave);
    await mkdir(dirname(r), { recursive: true });
    await writeFile(r, datos, { flag: "wx" });
  }
  async leer(clave: string) {
    try {
      return await readFile(this.ruta(clave));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async borrar(clave: string) {
    await rm(this.ruta(clave), { force: true });
  }
}

/** Para pruebas. */
export class AlmacenamientoMemoria implements Almacenamiento {
  readonly archivos = new Map<string, Buffer>();
  async guardar(clave: string, datos: Buffer) {
    this.archivos.set(clave, datos);
  }
  async leer(clave: string) {
    return this.archivos.get(clave) ?? null;
  }
  async borrar(clave: string) {
    this.archivos.delete(clave);
  }
}
