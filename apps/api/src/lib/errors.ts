import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERROR_CODES, IllegalTransitionError, type ApiErrorBody } from '@avn/contracts';
import { Prisma } from '@avn/database';
import { deps } from '../container';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, ERROR_CODES.VALIDATION, message, details);
export const unauthenticated = (message = 'Authentication required', code: string = ERROR_CODES.UNAUTHENTICATED) => new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to perform this action') => new AppError(403, ERROR_CODES.FORBIDDEN, message);
export const notFound = (what = 'Resource') => new AppError(404, ERROR_CODES.NOT_FOUND, `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, ERROR_CODES.CONFLICT, message, details);
export const paymentRequired = (message: string) => new AppError(402, ERROR_CODES.PAYMENT_REQUIRED, message);
export const tooMany = (message = 'Too many requests, please slow down') => new AppError(429, ERROR_CODES.RATE_LIMITED, message);

/** Consistent error envelope for every failure; internal details never leak to clients. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = String(req.id ?? '');
  const send = (status: number, body: ApiErrorBody['error']) => res.status(status).json({ error: { ...body, requestId } });

  if (err instanceof AppError) return send(err.status, { code: err.code, message: err.message, details: err.details });
  if (err instanceof ZodError) {
    return send(400, {
      code: ERROR_CODES.VALIDATION,
      message: 'Request validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof IllegalTransitionError) return send(409, { code: ERROR_CODES.ILLEGAL_TRANSITION, message: err.message });
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return send(409, { code: ERROR_CODES.CONFLICT, message: 'A record with these details already exists' });
    if (err.code === 'P2025') return send(404, { code: ERROR_CODES.NOT_FOUND, message: 'Resource not found' });
  }
  const e = err as { type?: string; status?: number; code?: string; message?: string };
  if (e.type === 'entity.parse.failed') return send(400, { code: ERROR_CODES.VALIDATION, message: 'Malformed JSON body' });
  if (e.type === 'entity.too.large' || e.code === 'LIMIT_FILE_SIZE') return send(413, { code: ERROR_CODES.VALIDATION, message: 'Payload too large' });
  if (e.code?.startsWith('LIMIT_')) return send(400, { code: ERROR_CODES.VALIDATION, message: e.message ?? 'Invalid upload' });

  deps().log.error({ err, requestId, path: req.path }, 'Unhandled error');
  return send(500, { code: ERROR_CODES.INTERNAL, message: 'Something went wrong. Please try again.' });
};
