import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/format";

/**
 * Buttons — docs/DESIGN_SYSTEM.md §6. One `primary` per view; everything else is
 * `secondary` or `ghost`. Destructive actions use `danger` (outlined, never a big red block).
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium " +
  "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-subtle active:bg-subtle",
  ghost: "text-ink-muted hover:bg-subtle hover:text-ink",
  danger: "border border-line-strong bg-surface text-danger-700 hover:border-danger-700 hover:bg-danger-50",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm lg:h-8",
  md: "h-11 px-4 text-sm lg:h-10",
  lg: "h-12 px-5 text-base",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}

type ExternalButtonProps = ComponentProps<"a"> & { variant?: ButtonVariant; size?: ButtonSize };

/** For tel:, WhatsApp and Maps links that hand off to another app. */
export function ExternalButton({ variant, size, className, ...props }: ExternalButtonProps) {
  return <a className={buttonClasses(variant, size, className)} {...props} />;
}
