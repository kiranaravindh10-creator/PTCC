import { adminSections } from "@/components/shell/nav";
import { Tabs } from "@/components/ui/tabs";
import type { Actor } from "@/server/access/actor";

/** People & access sub-navigation, showing only what the person may open. */
export function AdminTabs({ actor, active }: { actor: Actor; active: "people" | "roles" | "branches" | "scope" | "audit" }) {
  const items = adminSections(actor).map((section) => ({ href: section.href, label: section.label, active: section.key === active }));
  return (
    <div className="mb-6 overflow-x-auto">
      <Tabs label="People and access" items={items} />
    </div>
  );
}
