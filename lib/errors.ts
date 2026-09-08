// lib/errors.ts
//
// Minimal scaffold. PUL-106 adds the toast/message mapping. Class lives here
// early because getSessionUser (103.4) and authorize (104) both throw it before 106.
//
// The seven codes are the §13 error contract (§13 rule 6):
//   UNAUTHENTICATED · DEACTIVATED · FORBIDDEN · NOT_FOUND · VALIDATION · GATE · CONFLICT

export type AppErrorCode =
  | 'GATE'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'DEACTIVATED';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly meta?: Record<string, unknown>;

  constructor(code: AppErrorCode, message?: string, meta?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.meta = meta;
  }

  /**
   * The machine-readable GATE reason (§13 line 12) — e.g. `checklist_incomplete`.
   *
   * It lives in `meta.reason` so the wire shape stays a plain bag, but callers that
   * switch on it (the toast mapper, gate tests) shouldn't have to cast. Returns
   * undefined on any non-GATE error, and on a GATE whose reason wasn't set.
   */
  get reason(): string | undefined {
    const value = this.meta?.reason;
    return typeof value === 'string' ? value : undefined;
  }
}
