import { describe, expect, it } from "vitest";
import { generarLiguilla } from "./fixture.js";
import { ordenarTabla, type PartidoJugado } from "./posiciones.js";

const R = { victoria: 3, empate: 1, derrota: 0 };
const p = (
  localId: string,
  visitanteId: string,
  golesLocal: number,
  golesVisitante: number,
): PartidoJugado => ({
  localId,
  visitanteId,
  golesLocal,
  golesVisitante,
});
const orden = (f: { inscripcionId: string }[]) => f.map((x) => x.inscripcionId).join("");

describe("tabla de posiciones", () => {
  it("cuenta puntos, goles y partidos", () => {
    const t = ordenarTabla(["A", "B"], [p("A", "B", 3, 1), p("B", "A", 2, 2)], R, []);
    expect(t[0]).toMatchObject({
      inscripcionId: "A",
      pj: 2,
      pg: 1,
      pe: 1,
      pp: 0,
      gf: 5,
      gc: 3,
      dg: 2,
      puntos: 4,
      posicion: 1,
    });
    expect(t[1]).toMatchObject({
      inscripcionId: "B",
      pj: 2,
      pg: 0,
      pe: 1,
      pp: 1,
      gf: 3,
      gc: 5,
      dg: -2,
      puntos: 1,
      posicion: 2,
    });
  });
  it("respeta los puntos del torneo (p. ej. 2 por victoria)", () => {
    const t = ordenarTabla(
      ["A", "B"],
      [p("A", "B", 1, 0)],
      { victoria: 2, empate: 1, derrota: 0 },
      [],
    );
    expect(t[0]?.puntos).toBe(2);
  });
  it("desempata por diferencia de gol", () => {
    // A y B suman 3 puntos; A tiene mejor diferencia
    const t = ordenarTabla(
      ["B", "A", "C"],
      [p("A", "C", 4, 0), p("B", "C", 1, 0), p("A", "B", 0, 1), p("B", "A", 0, 1)],
      R,
      ["diferencia_gol"],
    );
    expect(orden(t)).toBe("ABC");
  });
  it("aplica los criterios en el orden configurado", () => {
    // Igualados en puntos: X (dg +1, gf 3) vs Y (dg +1, gf 2) -> gana X por goles a favor
    const partidos = [p("X", "Z", 3, 2), p("Y", "Z", 2, 1), p("Z", "X", 0, 0), p("Z", "Y", 0, 0)];
    expect(
      orden(ordenarTabla(["Y", "X", "Z"], partidos, R, ["diferencia_gol", "goles_favor"])),
    ).toBe("XYZ");
    // Con 'goles_contra' primero, Y (1 en contra) supera a X (2 en contra)
    expect(orden(ordenarTabla(["Y", "X", "Z"], partidos, R, ["goles_contra"]))).toBe("YXZ");
  });
  // A y B terminan con 4 puntos. A ganó el duelo directo (1-0) pero B tiene mejor diferencia de gol.
  const duelo = [
    p("A", "B", 1, 0),
    p("A", "C", 0, 0),
    p("A", "D", 0, 2),
    p("B", "C", 5, 0),
    p("B", "D", 0, 0),
    p("C", "D", 0, 0),
  ];
  it("enfrentamiento directo: entre dos empatados gana quien ganó el duelo, aunque tenga peor diferencia", () => {
    expect(orden(ordenarTabla(["A", "B", "C", "D"], duelo, R, ["enfrentamiento_directo"]))).toBe(
      "DABC",
    );
  });
  it("el mismo empate se resuelve distinto según el orden de criterios configurado", () => {
    expect(
      orden(
        ordenarTabla(["A", "B", "C", "D"], duelo, R, ["diferencia_gol", "enfrentamiento_directo"]),
      ),
    ).toBe("DBAC");
    expect(
      orden(
        ordenarTabla(["A", "B", "C", "D"], duelo, R, ["enfrentamiento_directo", "diferencia_gol"]),
      ),
    ).toBe("DABC");
  });
  it("triple empate en círculo: la mini-tabla entre los tres decide por diferencia de gol", () => {
    // A>B 1-0, B>C 5-0, C>A 2-0: los tres con 3 puntos. En la mini-tabla: B (+4), A (-1), C (-3)
    const circulo = [p("A", "B", 1, 0), p("B", "C", 5, 0), p("C", "A", 2, 0)];
    expect(orden(ordenarTabla(["A", "B", "C"], circulo, R, ["enfrentamiento_directo"]))).toBe(
      "BAC",
    );
  });
  it("si siguen empatados respeta el orden de inscripción y las posiciones son consecutivas", () => {
    const t = ordenarTabla(["M", "N", "O"], [], R, [
      "diferencia_gol",
      "goles_favor",
      "enfrentamiento_directo",
    ]);
    expect(orden(t)).toBe("MNO");
    expect(t.map((x) => x.posicion)).toEqual([1, 2, 3]);
  });
  it("ignora partidos de equipos que no están en la tabla (otro grupo)", () => {
    const t = ordenarTabla(["A", "B"], [p("A", "Z", 9, 0), p("A", "B", 1, 1)], R, []);
    expect(t.find((x) => x.inscripcionId === "A")).toMatchObject({ pj: 1, puntos: 1, gf: 1 });
  });
});

describe("calendario de liguilla", () => {
  const pares = (cs: { local: string; visitante: string }[]) =>
    cs.map((c) => [c.local, c.visitante].sort().join("-"));
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    it(`${n} equipos: todos se enfrentan una vez y nadie juega dos veces en la misma jornada`, () => {
      const ids = Array.from({ length: n }, (_, i) => `E${i + 1}`);
      const cs = generarLiguilla(ids);
      expect(cs.length).toBe((n * (n - 1)) / 2);
      expect(new Set(pares(cs)).size).toBe(cs.length);
      const porJornada = new Map<number, string[]>();
      for (const c of cs)
        porJornada.set(c.jornada, [...(porJornada.get(c.jornada) ?? []), c.local, c.visitante]);
      for (const eq of porJornada.values()) expect(new Set(eq).size).toBe(eq.length);
      expect(Math.max(...cs.map((c) => c.jornada))).toBe(n % 2 === 0 ? n - 1 : n);
    });
  }
  it("ida y vuelta: cada cruce se juega dos veces con la localía invertida", () => {
    const cs = generarLiguilla(["A", "B", "C", "D"], true);
    expect(cs.length).toBe(12);
    const ida = cs.filter((c) => c.jornada <= 3);
    for (const c of ida) {
      expect(
        cs.some((v) => v.jornada > 3 && v.local === c.visitante && v.visitante === c.local),
      ).toBe(true);
    }
  });
  it("reparte la localía de forma equilibrada", () => {
    const cs = generarLiguilla(["A", "B", "C", "D", "E", "F"]);
    const locales = new Map<string, number>();
    for (const c of cs) locales.set(c.local, (locales.get(c.local) ?? 0) + 1);
    for (const v of locales.values()) expect(v).toBeGreaterThanOrEqual(1);
    expect(Math.max(...locales.values()) - Math.min(...[...locales.values()])).toBeLessThanOrEqual(
      3,
    );
  });
  it("con menos de 2 equipos no hay partidos", () => {
    expect(generarLiguilla([])).toEqual([]);
    expect(generarLiguilla(["A"])).toEqual([]);
  });
});
