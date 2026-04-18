import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Base error class
// ---------------------------------------------------------------------------

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly isOperational = true,
  ) {
    super(message)
    this.name = this.constructor.name
    // Maintains correct prototype chain in transpiled output
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ---------------------------------------------------------------------------
// Subclasses
// ---------------------------------------------------------------------------

export class ValidationError extends AppError {
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message, code, 400)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Not authenticated', code = 'UNAUTHORIZED') {
    super(message, code, 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, code, 403)
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code = 'NOT_FOUND') {
    super(message, code, 404)
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, code, 409)
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', code = 'RATE_LIMITED') {
    super(message, code, 429)
  }
}

export class FourEyesViolationError extends ForbiddenError {
  constructor(
    public readonly field: string,
    message = 'Four-eyes policy violation',
  ) {
    super(message, 'FOUR_EYES_VIOLATION')
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { message: error.message, code: error.code } },
      { status: error.statusCode },
    )
  }

  // Unknown / programmer error — never leak internals in production
  const isProduction = process.env.NODE_ENV === 'production'
  const message = !isProduction && error instanceof Error
    ? error.message
    : 'An unexpected error occurred'

  return NextResponse.json(
    { error: { message, code: 'INTERNAL_ERROR' } },
    { status: 500 },
  )
}

export function handleApiError(error: unknown, context: string): NextResponse {
  if (error instanceof AppError && error.isOperational) {
    // Expected errors — log at warn level only
    console.warn(`[${context}] ${error.name}: ${error.message}`)
  } else {
    // Programmer or infrastructure errors — log at error level with full detail
    console.error(`[${context}] Unhandled error:`, error)
  }
  return errorResponse(error)
}
