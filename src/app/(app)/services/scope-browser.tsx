"use client";

import { ServiceSearch } from "@/modules/leads/ui/service-picker";

/** Read-only search of PTCC's scope for the Services page. */
export function ScopeBrowserSearch() {
  return <ServiceSearch branchId={null} branchName={null} />;
}
