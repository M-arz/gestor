import type { Criterio } from "../dominio.js";

export interface ReglasPuntos {
  victoria: number;
  empate: number;
  derrota: number;
}
export interface PartidoJugado {
  localId: string;
  visitanteId: string;
  golesLocal: number;
  golesVisitante: number;
}
export interface Estadistica {
  inscripcionId: string;
  pj: number;
  pg: number;
  pe: number;
  pp: number;
  gf: number;
  gc: number;
  dg: number;
  puntos: number;
}
export interface FilaPosicion extends Estadistica {
  posicion: number;
}

/** Estadísticas de `ids` contando solo los partidos jugados entre ellos. */
export function calcular(
  ids: string[],
  partidos: PartidoJugado[],
  r: ReglasPuntos,
): Map<string, Estadistica> {
  const m = new Map<string, Estadistica>(
    ids.map((id) => [
      id,
      { inscripcionId: id, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, dg: 0, puntos: 0 },
    ]),
  );
  const aplicar = (e: Estadistica, gf: number, gc: number) => {
    e.pj++;
    e.gf += gf;
    e.gc += gc;
    e.dg = e.gf - e.gc;
    if (gf > gc) {
      e.pg++;
      e.puntos += r.victoria;
    } else if (gf === gc) {
      e.pe++;
      e.puntos += r.empate;
    } else {
      e.pp++;
      e.puntos += r.derrota;
    }
  };
  for (const p of partidos) {
    const l = m.get(p.localId);
    const v = m.get(p.visitanteId);
    if (!l || !v) continue;
    aplicar(l, p.golesLocal, p.golesVisitante);
    aplicar(v, p.golesVisitante, p.golesLocal);
  }
  return m;
}

/** Ordena de mayor a menor por una clave numérica y separa en subgrupos de iguales. */
function particionar(ids: string[], clave: (id: string) => number[]): string[][] {
  const orden = [...ids].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return (kb[i] ?? 0) - (ka[i] ?? 0);
    return 0; // estable: respeta el orden de entrada
  });
  const grupos: string[][] = [];
  for (const id of orden) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && clave(ultimo[0]!).every((v, i) => v === clave(id)[i])) ultimo.push(id);
    else grupos.push([id]);
  }
  return grupos;
}

/**
 * Tabla ordenada: primero puntos y luego los criterios en el orden configurado.
 * El enfrentamiento directo es una mini-tabla solo entre los equipos empatados.
 * Si tras todos los criterios siguen empatados, se respeta el orden de inscripción.
 */
export function ordenarTabla(
  ids: string[],
  partidos: PartidoJugado[],
  reglas: ReglasPuntos,
  criterios: Criterio[],
): FilaPosicion[] {
  const stats = calcular(ids, partidos, reglas);
  let grupos = particionar(ids, (id) => [stats.get(id)!.puntos]);

  for (const criterio of criterios) {
    grupos = grupos.flatMap((g) => {
      if (g.length === 1) return [g];
      if (criterio === "enfrentamiento_directo") {
        const mini = calcular(g, partidos, reglas);
        return particionar(g, (id) => {
          const s = mini.get(id)!;
          return [s.puntos, s.dg, s.gf];
        });
      }
      return particionar(g, (id) => {
        const s = stats.get(id)!;
        if (criterio === "diferencia_gol") return [s.dg];
        if (criterio === "goles_favor") return [s.gf];
        if (criterio === "goles_contra") return [-s.gc]; // menos goles en contra es mejor
        return [s.pg]; // victorias
      });
    });
  }
  return grupos.flat().map((id, i) => ({ ...stats.get(id)!, posicion: i + 1 }));
}
