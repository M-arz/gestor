import type { OutboxStore } from "@gestor/shared";

/**
 * Outbox de notifications: este servicio todavía no publica eventos propios
 * (las tablas y la integración son la fase 5). Devuelve lotes vacíos para
 * que el publicador inactivo no falle.
 */
export function crearOutboxStore(): OutboxStore {
  return {
    async procesarLote() {
      return 0;
    },
  };
}
