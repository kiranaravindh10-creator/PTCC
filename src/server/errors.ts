/**
 * Typed errors thrown by module services. Server actions translate them into
 * plain-language messages (src/server/action-result.ts); anything else is treated as
 * unexpected and logged.
 */

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input failed validation. `fieldErrors` maps form field names to messages. */
export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** The actor is not allowed to do this. */
export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super(message);
  }
}

/** The record does not exist — or exists outside the actor's scope (deliberately indistinguishable). */
export class NotFoundError extends AppError {
  constructor(message = "We couldn't find that. It may have been removed, or you may not have access.") {
    super(message);
  }
}

/** The request conflicts with the current state (e.g. the work was already completed). */
export class ConflictError extends AppError {}

/** The feature is designed but not built or connected yet (e.g. an external integration). */
export class NotImplementedError extends AppError {
  constructor(message = "This isn't available yet.") {
    super(message);
  }
}
