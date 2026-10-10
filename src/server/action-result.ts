import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppError, ValidationError } from "./errors";

/**
 * The shape every form action returns to `useActionState`.
 * `values` echoes what was submitted so the form can be re-filled after an error.
 */
export type ActionState =
  | { status: "idle" }
  | { status: "success"; message?: string; data?: Record<string, string> }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string>;
      values?: Record<string, string | string[]>;
    };

export const IDLE: ActionState = { status: "idle" };

/**
 * Converts a thrown error into an ActionState. Next.js control-flow errors
 * (redirect, notFound) are re-thrown so they keep working inside try/catch.
 */
export function actionError(error: unknown, values?: Record<string, string | string[]>): ActionState {
  unstable_rethrow(error);
  if (error instanceof ValidationError) {
    return { status: "error", message: error.message, fieldErrors: error.fieldErrors, values };
  }
  if (error instanceof AppError) {
    return { status: "error", message: error.message, values };
  }
  console.error("[action] unexpected error", error);
  return { status: "error", message: "Something went wrong on our side. Please try again.", values };
}
