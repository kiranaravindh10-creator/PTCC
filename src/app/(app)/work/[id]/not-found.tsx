import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";

export default function WorkNotFound() {
  return (
    <div className="max-w-3xl">
      <EmptyState
        icon={<SearchX />}
        title="We couldn't find that work"
        description="It may have been reassigned to someone else, or you may not have access to it."
        action={
          <ButtonLink href="/work" variant="secondary">
            Back to My Work
          </ButtonLink>
        }
      />
    </div>
  );
}
