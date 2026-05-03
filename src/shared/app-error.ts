// ─────────────────────────────────────────────────────────────────────────────
// Typed Application Error — used by all services for HTTP-aware error handling
// ─────────────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
