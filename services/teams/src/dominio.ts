export const POSICIONES = ["portero", "defensa", "mediocampista", "delantero"] as const;
export const TIPOS_DOCUMENTO = ["RC", "TI", "CC", "CE", "PPT", "PEP", "PA"] as const;
export type Posicion = (typeof POSICIONES)[number];
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];
export const MAYORIA_DE_EDAD = 18; // Colombia
