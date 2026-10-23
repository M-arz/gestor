import ExcelJS from "exceljs";
import type { TablaVista } from "../services/posiciones.service.js";

/** Nombre de hoja válido en Excel: máx. 31 caracteres y sin []:*?/\ */
const nombreHoja = (n: string, usados: Set<string>) => {
  const base =
    n
      .replace(/[[\]:*?/\\]/g, " ")
      .trim()
      .slice(0, 31) || "Posiciones";
  let nombre = base;
  for (let k = 2; usados.has(nombre.toLowerCase()); k++) nombre = `${base.slice(0, 28)} ${k}`;
  usados.add(nombre.toLowerCase());
  return nombre;
};

/** Tabla de posiciones en .xlsx, generada en el servidor. Una hoja por grupo. */
export async function posicionesAExcel(torneo: string, tablas: TablaVista[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GESTOR";
  const usados = new Set<string>();
  const lista = tablas.length ? tablas : [{ grupoId: null, grupo: null, filas: [] } as TablaVista];
  for (const t of lista) {
    const ws = wb.addWorksheet(nombreHoja(t.grupo ?? "Posiciones", usados));
    ws.addRow([`${torneo}${t.grupo ? ` - ${t.grupo}` : ""}`]).font = { bold: true, size: 14 };
    ws.addRow([]);
    const cab = ws.addRow(["Pos", "Equipo", "PJ", "PG", "PE", "PP", "GF", "GC", "DG", "Pts"]);
    cab.font = { bold: true };
    cab.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
    });
    for (const f of t.filas) {
      // Los nombres se guardan como texto, nunca como fórmulas.
      ws.addRow([
        f.posicion,
        String(f.equipo.nombre),
        f.pj,
        f.pg,
        f.pe,
        f.pp,
        f.gf,
        f.gc,
        f.dg,
        f.puntos,
      ]);
    }
    ws.columns = [
      { width: 6 },
      { width: 32 },
      { width: 6 },
      { width: 6 },
      { width: 6 },
      { width: 6 },
      { width: 6 },
      { width: 6 },
      { width: 6 },
      { width: 6 },
    ];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
