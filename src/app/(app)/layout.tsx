import Link from "next/link";
import { Suspense } from "react";
import { BottomNav, Logo, MobileBell, SidebarNav, SidebarNavSkeleton } from "@/components/shell/shell";

/**
 * The signed-in area. Desktop: left sidebar. Phone: top bar + bottom navigation.
 * Nothing here reads the session at the top level — those parts stream in behind
 * Suspense so the frame is instant (Next.js Cache Components).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-4 py-2 font-medium text-brand-700 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-62 flex-col border-r border-line bg-surface lg:flex">
        <Link href="/" className="mx-5 mt-6 mb-6 block w-44 rounded-control" aria-label="PTCC home">
          <Logo className="h-auto w-full" />
        </Link>
        <Suspense fallback={<SidebarNavSkeleton />}>
          <SidebarNav />
        </Suspense>
      </aside>

      {/* Phone top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Link href="/" className="block w-28 rounded-control" aria-label="PTCC home">
          <Logo className="h-auto w-full" />
        </Link>
        <Suspense fallback={<span className="size-11" />}>
          <MobileBell />
        </Suspense>
      </header>

      <main id="main" className="px-4 pt-5 pb-28 lg:pl-62 lg:pb-16">
        <div className="mx-auto w-full max-w-[72rem] lg:px-10 lg:pt-10">{children}</div>
      </main>

      {/* Phone bottom navigation */}
      <nav
        aria-label="Main"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
      >
        <Suspense fallback={<div className="h-16" />}>
          <BottomNav />
        </Suspense>
      </nav>
    </div>
  );
}
