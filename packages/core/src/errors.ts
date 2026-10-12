export type FormaErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVICE_CLOSED'
  | 'STORAGE_FAILURE';

export class FormaError extends Error {
  readonly code: FormaErrorCode;
  readonly field: string | undefined;

  constructor(
    code: FormaErrorCode,
    message: string,
    options: { field?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'FormaError';
    this.code = code;
    this.field = options.field;
  }
}
