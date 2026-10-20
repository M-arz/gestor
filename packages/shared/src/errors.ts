/** Forma única de error para toda la plataforma. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    correlationId: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  badRequest: (message: string, details?: unknown) =>
    new AppError(400, "BAD_REQUEST", message, details),
  unauthorized: (message = "No autenticado") => new AppError(401, "UNAUTHORIZED", message),
  forbidden: (message = "No tienes permiso para esta acción") =>
    new AppError(403, "FORBIDDEN", message),
  notFound: (message = "Recurso no encontrado") => new AppError(404, "NOT_FOUND", message),
  conflict: (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details),
  tooManyRequests: (message = "Demasiadas solicitudes") =>
    new AppError(429, "TOO_MANY_REQUESTS", message),
};
