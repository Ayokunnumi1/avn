/** Consistent API error envelope returned by every endpoint. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  INTERNAL: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
