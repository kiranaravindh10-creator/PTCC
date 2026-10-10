import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-sm text-ink-subtle">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="mt-1 max-w-sm text-ink-muted">It may have moved, or you may not have access to it.</p>
      <Link href="/" className={buttonClasses("primary", "md", "mt-6")}>
        Go to Home
      </Link>
    </div>
  );
}
