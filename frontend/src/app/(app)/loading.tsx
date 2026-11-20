import { PageContainer } from "@/components/app/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown inside the app shell while the next page loads, so a sidebar click answers at once. */
export default function Loading() {
  return (
    <PageContainer aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-72" />
    </PageContainer>
  );
}
