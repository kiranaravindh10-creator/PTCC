import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";

export default function CustomerNotFound() {
  return (
    <div className="max-w-3xl">
      <EmptyState
        icon={<SearchX />}
        title="We couldn't find that customer"
        description="It may not be linked to your branch, or you may not have access to it."
        action={
          <ButtonLink href="/customers" variant="secondary">
            Back to Customers
          </ButtonLink>
        }
      />
    </div>
  );
}
