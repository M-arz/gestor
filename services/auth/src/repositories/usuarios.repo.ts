import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/types.js";
import { usuarios } from "../db/schema.js";

export type Usuario = typeof usuarios.$inferSelect;

export const usuariosRepo = {
  async findByCorreo(db: Db, correo: string) {
    const rows = await db
      .select()
      .from(usuarios)
      .where(sql`lower(${usuarios.correo}) = ${correo.toLowerCase()}`)
      .limit(1);
    return rows[0];
  },
  async findById(db: Db, id: string) {
    const rows = await db.select().from(usuarios).where(eq(usuarios.id, id)).limit(1);
    return rows[0];
  },
  insert: (db: Db, row: typeof usuarios.$inferInsert) => db.insert(usuarios).values(row),
  update: (db: Db, id: string, patch: Partial<typeof usuarios.$inferInsert>) =>
    db.update(usuarios).set(patch).where(eq(usuarios.id, id)),
};
