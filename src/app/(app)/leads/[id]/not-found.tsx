import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";

export default function LeadNotFound() {
  return (
    <div className="max-w-3xl">
      <EmptyState
        icon={<SearchX />}
        title="We couldn't find that lead"
        description="It may belong to another branch, have been reassigned, or you may not have access to it."
        action={
          <ButtonLink href="/leads" variant="secondary">
            Back to Leads
          </ButtonLink>
        }
      />
    </div>
  );
}
