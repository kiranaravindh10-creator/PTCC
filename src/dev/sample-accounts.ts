/**
 * DEVELOPMENT ONLY — sample people created by `npm run db:seed`.
 * Used by the seed script and by the sign-in page's development helper, which is
 * never rendered in production builds. Fictional people; not business data.
 */

import type { RoleKey } from "@/server/access/roles";

export const SAMPLE_PASSWORD = "precise2026";

export const SAMPLE_PEOPLE = [
  { key: "ceo", name: "Mohan Krishnan", phone: "9000000001", roles: ["ceo"], branch: null, designation: "Managing Director & CEO" },
  { key: "admin", name: "Deepa Nair", phone: "9000000002", roles: ["admin"], branch: null, designation: "Systems Administrator" },
  // Bengaluru
  { key: "hr", name: "Priya Sharma", phone: "9000000003", roles: ["hr"], branch: "Bengaluru", designation: "Branch Coordinator" },
  { key: "sneha", name: "Sneha Kulkarni", phone: "9000000005", roles: ["marketing_manager"], branch: "Bengaluru", designation: "Marketing Manager" },
  { key: "rahul", name: "Rahul Menon", phone: "9000000004", roles: ["marketing"], branch: "Bengaluru", designation: "Marketing Executive" },
  { key: "arun", name: "Arun Kumar", phone: "9000000006", roles: ["collection"], branch: "Bengaluru", designation: "Field Executive – Collections" },
  { key: "manju", name: "Manjunath Gowda", phone: "9000000007", roles: ["collection"], branch: "Bengaluru", designation: "Field Executive – Collections" },
  { key: "lakshmi", name: "Lakshmi Narayan", phone: "9000000008", roles: ["operations"], branch: "Bengaluru", designation: "Lab In-charge" },
  { key: "fathima", name: "Fathima Begum", phone: "9000000009", roles: ["accounts"], branch: "Bengaluru", designation: "Accounts Executive" },
  // Chennai
  { key: "karthik", name: "Karthik Subramanian", phone: "9000000010", roles: ["hr"], branch: "Chennai", designation: "Branch Coordinator" },
  { key: "divya", name: "Divya Raman", phone: "9000000011", roles: ["marketing"], branch: "Chennai", designation: "Marketing Executive" },
  { key: "senthil", name: "Senthil Murugan", phone: "9000000012", roles: ["collection"], branch: "Chennai", designation: "Field Executive – Collections" },
  // Hosur
  { key: "ganesh", name: "Ganesh Babu", phone: "9000000013", roles: ["hr"], branch: "Hosur", designation: "Branch Coordinator" },
  { key: "meena", name: "Meena Rajan", phone: "9000000014", roles: ["marketing"], branch: "Hosur", designation: "Marketing Executive" },
  // Hyderabad
  { key: "srinivas", name: "Srinivas Reddy", phone: "9000000015", roles: ["hr"], branch: "Hyderabad", designation: "Branch Coordinator" },
  { key: "lavanya", name: "Lavanya Rao", phone: "9000000016", roles: ["marketing"], branch: "Hyderabad", designation: "Marketing Executive" },
] as const satisfies ReadonlyArray<{
  key: string;
  name: string;
  phone: string;
  roles: readonly RoleKey[];
  branch: string | null;
  designation: string;
}>;

export type SamplePersonKey = (typeof SAMPLE_PEOPLE)[number]["key"];
