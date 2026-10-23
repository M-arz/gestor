export interface Cruce {
  jornada: number;
  local: string;
  visitante: string;
}

/**
 * Calendario todos contra todos (método del círculo). Con número impar de equipos,
 * uno descansa en cada jornada. `idaVuelta` repite los cruces con la localía invertida.
 */
export function generarLiguilla(ids: string[], idaVuelta = false): Cruce[] {
  if (ids.length < 2) return [];
  const eq: (string | null)[] = [...ids];
  if (eq.length % 2 === 1) eq.push(null);
  const n = eq.length;
  const rondas = n - 1;
  const ida: Cruce[] = [];
  for (let r = 0; r < rondas; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = eq[i];
      const b = eq[n - 1 - i];
      if (!a || !b) continue;
      const [local, visitante] = (r + i) % 2 === 0 ? [a, b] : [b, a];
      ida.push({ jornada: r + 1, local, visitante });
    }
    eq.splice(1, 0, eq.pop() as string | null); // rota todos menos el primero
  }
  if (!idaVuelta) return ida;
  return [
    ...ida,
    ...ida.map((c) => ({ jornada: c.jornada + rondas, local: c.visitante, visitante: c.local })),
  ];
}
