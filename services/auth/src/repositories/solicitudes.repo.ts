
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/types.js";
import { solicitudesAdmin } from "../db/schema.js";

export const solicitudesRepo = {
  insert: (db: Db, row: typeof solicitudesAdmin.$inferInsert) =>
    db.insert(solicitudesAdmin).values(row),

  async findById(db: Db, id: string) {
    const rows = await db
      .select()
      .from(solicitudesAdmin)
      .where(eq(solicitudesAdmin.id, id))
      .limit(1);

    return rows[0];
  },

  /** Completa una solicitud solo si todavía está pendiente. */
  async completar(db: Db, id: string, ahora: Date) {
    const rows = await db
      .update(solicitudesAdmin)
      .set({ completadaEn: ahora })
      .where(
        and(
          eq(solicitudesAdmin.id, id),
          isNull(solicitudesAdmin.completadaEn),
        ),
      )
      .returning({ id: solicitudesAdmin.id });

    return rows.length === 1;
  },
};
