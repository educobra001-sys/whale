export class ApplicationError extends Error {
    constructor(message: string, public status: number, public override cause?: unknown) {
        super(message, { cause })
    }
}

export class BadRequestError extends ApplicationError {
    constructor(message: string, cause?: unknown) {
        super(message, 400, cause)
    }
}

export class UnauthorizedError extends ApplicationError {
    constructor(message = "Your session expired. Please sign in again.", cause?: unknown) {
        super(message, 401, cause)
    }
}

export class ForbiddenError extends ApplicationError {
    constructor(message = "You don't have permission to do that.", cause?: unknown) {
        super(message, 403, cause)
    }
}

export class NotFoundError extends ApplicationError {
    constructor(message: string, cause?: unknown) {
        super(message, 404, cause)
    }
}

export class ConflictError extends ApplicationError {
    constructor(message: string, cause?: unknown) {
        super(message, 409, cause)
    }
}

export class TooManyRequestsError extends ApplicationError {
    constructor(message = "Too many attempts. Please wait and try again.", cause?: unknown) {
        super(message, 429, cause)
    }
}
