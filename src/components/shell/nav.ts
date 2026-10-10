import { can, canAny, scopeOf, type Actor } from "@/server/access/actor";

/**
 * Navigation per person — docs/PRODUCT_ARCHITECTURE.md §3. A handful of main destinations,
 * plus a short Manage group for roles that need it. Computed on the server; items are plain
 * data so they can be passed to the client nav component.
 */

export type NavIcon = "home" | "work" | "leads" | "customers" | "collections" | "communication" | "ask" | "people";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Not built yet — shown with a "Soon" tag and an honest placeholder page. */
  planned?: { phase: number };
  /** Shows the unread-notification count. */
  showsUnread?: boolean;
  /** Other paths that belong to this item (for the active state). */
  also?: string[];
  /** In the sidebar and under More, but never in the phone's bottom bar. */
  secondary?: boolean;
};

export function canSeeLeads(actor: Actor): boolean {
  return scopeOf(actor, "marketing.read") !== null || scopeOf(actor, "marketing.assign") !== null || can(actor, "lead.route");
}

export function mainNav(actor: Actor): NavItem[] {
  const items: NavItem[] = [
    { href: "/", label: "Home", icon: "home" },
    { href: "/work", label: "My Work", icon: "work" },
  ];
  if (canSeeLeads(actor)) items.push({ href: "/leads", label: "Leads", icon: "leads" });
  // Everyone may add a lead; for people who don't work leads it opens on the leads they added.
  else if (can(actor, "lead.capture")) items.push({ href: "/leads", label: "Leads", icon: "leads", secondary: true });
  if (canAny(actor, "customer.read", "customer.read.all")) {
    items.push({ href: "/customers", label: "Customers", icon: "customers", also: ["/services"] });
  }
  if (scopeOf(actor, "collection.read") !== null) {
    items.push({ href: "/collections", label: "Collections", icon: "collections" });
  }
  items.push({ href: "/communication", label: "Communication", icon: "communication", showsUnread: true });
  items.push({ href: "/ask", label: "Ask PTCC", icon: "ask", planned: { phase: 7 } });
  return items;
}

export function manageNav(actor: Actor): NavItem[] {
  const first = adminSections(actor)[0];
  return first ? [{ href: first.href, label: "People & access", icon: "people", also: ["/admin"] }] : [];
}

/** The Admin area's sections this person may open, in order. */
export function adminSections(actor: Actor): { key: "people" | "roles" | "branches" | "scope" | "audit"; href: string; label: string }[] {
  const sections: { key: "people" | "roles" | "branches" | "scope" | "audit"; href: string; label: string }[] = [];
  if (can(actor, "user.manage")) sections.push({ key: "people", href: "/admin/people", label: "People" });
  if (canAny(actor, "role.manage", "user.manage")) sections.push({ key: "roles", href: "/admin/roles", label: "Roles" });
  if (can(actor, "branch.manage")) sections.push({ key: "branches", href: "/admin/branches", label: "Branches" });
  if (can(actor, "catalogue.manage")) sections.push({ key: "scope", href: "/admin/scope", label: "Scope" });
  if (can(actor, "audit.read")) sections.push({ key: "audit", href: "/admin/audit", label: "Activity log" });
  return sections;
}

/** Bottom bar on phones: up to three live destinations, then More. */
export function mobileNav(actor: Actor): NavItem[] {
  return mainNav(actor)
    .filter((item) => !item.planned && !item.secondary && item.href !== "/communication")
    .slice(0, 3);
}
