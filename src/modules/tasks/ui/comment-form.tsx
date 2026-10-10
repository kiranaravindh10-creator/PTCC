"use client";

import { useActionState } from "react";
import { describedBy, FieldError, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/server/action-result";
import { addCommentAction } from "../actions";

const IDLE: ActionState = { status: "idle" };

/** Add a note to a work item. Everyone on the work is notified. */
export function CommentForm({ taskId }: { taskId: string }) {
  const [state, formAction] = useActionState(addCommentAction, IDLE);
  const error = state.status === "error" ? (state.fieldErrors?.body ?? state.message) : undefined;
  const draft = state.status === "error" && typeof state.values?.body === "string" ? state.values.body : "";
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="taskId" value={taskId} />
      <label htmlFor="note" className="sr-only">
        Add a note
      </label>
      <Textarea
        key={draft}
        {...describedBy("note", error)}
        name="body"
        rows={2}
        defaultValue={draft}
        placeholder="Add a note — e.g. gate pass needed, customer asked to come after 2 PM"
      />
      <FieldError id="note" error={error} />
      <div className="flex justify-end">
        <SubmitButton variant="secondary" size="sm" pendingLabel="Adding…">
          Add note
        </SubmitButton>
      </div>
    </form>
  );
}
