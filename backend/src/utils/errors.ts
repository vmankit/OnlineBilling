/**
 * Application errors. Anything that is NOT an AppError is treated as an
 * unexpected fault: logged with full detail server-side, reported to the
 * client as a generic 500 with no stack trace.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Your session has expired. Please sign in again.') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found.`);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);

export const insufficientStock = (itemName: string, available: number, requested: number, unit: string) =>
  new AppError(
    409,
    'INSUFFICIENT_STOCK',
    `Insufficient stock for ${itemName}. Available ${available} ${unit}, requested ${requested} ${unit}.`,
    { itemName, available, requested, unit },
  );

export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, 'UNPROCESSABLE', message, details);
