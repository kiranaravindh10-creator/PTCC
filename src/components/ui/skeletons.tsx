import { Skeleton } from "./display";

/** Loading placeholders shaped like the pages they stand in for. */

export function ListSkeleton({ title }: { title: string }) {
  return (
    <div className="max-w-3xl space-y-6" aria-busy="true" aria-label={`Loading ${title}`}>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-9 w-56" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="max-w-3xl space-y-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-11 w-72 max-w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="max-w-2xl space-y-6" aria-busy="true" aria-label="Loading form">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-11 w-36" />
    </div>
  );
}
