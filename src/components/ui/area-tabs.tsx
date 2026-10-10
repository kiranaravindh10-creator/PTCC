import { Tabs } from "./tabs";

/** Sub-navigation of the Customers area: customers and PTCC's service catalogue. */
export function CustomersAreaTabs({ active }: { active: "customers" | "services" }) {
  return (
    <div className="mb-6">
      <Tabs
        label="Customers area"
        items={[
          { href: "/customers", label: "Customers", active: active === "customers" },
          { href: "/services", label: "Services (scope)", active: active === "services" },
        ]}
      />
    </div>
  );
}
