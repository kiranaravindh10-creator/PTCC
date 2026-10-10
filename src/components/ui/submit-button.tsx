"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button";

type SubmitButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Text shown while the form is being submitted. */
  pendingLabel?: string;
};

/** Submit button that disables itself and says what's happening while the action runs. */
export function SubmitButton({
  variant = "primary",
  size,
  className,
  pendingLabel = "Saving…",
  children,
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={buttonClasses(variant, size, className)}
      disabled={pending || disabled}
      aria-disabled={pending || disabled}
      {...props}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
