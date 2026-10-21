/** Si el error es una violación de unicidad, devuelve el nombre de la restricción. */
export function violacionUnica(e: unknown): string | null {
  const err = e as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = err?.code ?? err?.cause?.code;
  if (code !== "23505") return null;
  return err.constraint ?? err.cause?.constraint ?? "desconocida";
}
