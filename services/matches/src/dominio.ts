export const FORMATOS = ["grupos", "liguilla"] as const;
export const ESTADOS_TORNEO = [
  "borrador",
  "inscripciones_abiertas",
  "en_juego",
  "finalizado",
  "archivado",
] as const;
export type EstadoTorneo = (typeof ESTADOS_TORNEO)[number];

/** Qué cambios de estado del torneo están permitidos. */
export const TRANSICIONES: Record<EstadoTorneo, readonly EstadoTorneo[]> = {
  borrador: ["inscripciones_abiertas", "archivado"],
  inscripciones_abiertas: ["en_juego", "archivado"],
  en_juego: ["finalizado"],
  finalizado: ["archivado"],
  archivado: [],
};

export const CRITERIOS = [
  "diferencia_gol",
  "goles_favor",
  "goles_contra",
  "victorias",
  "enfrentamiento_directo",
] as const;
export type Criterio = (typeof CRITERIOS)[number];
export const CRITERIOS_POR_DEFECTO: Criterio[] = [
  "diferencia_gol",
  "goles_favor",
  "enfrentamiento_directo",
];

export const TIPOS_EVENTO = ["gol", "autogol", "asistencia", "amarilla", "roja"] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export const FASES = ["grupos", "liguilla", "eliminatoria"] as const;
/** Solo estas fases suman a la tabla de posiciones. */
export const FASES_QUE_PUNTUAN = ["grupos", "liguilla"];
