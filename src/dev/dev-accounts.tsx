import { connection } from "next/server";
import { ROLES } from "@/server/access/roles";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { devSignInAction } from "./actions";
import { SAMPLE_PASSWORD, SAMPLE_PEOPLE } from "./sample-accounts";

/**
 * DEVELOPMENT ONLY — one-click sign-in as each sample person, to explore every role.
 * Rendered only when NODE_ENV !== "production"; the action also refuses in production.
 * It performs a normal password sign-in with the sample password — no bypass.
 */
export async function DevAccounts() {
  await connection();
  if (process.env.NODE_ENV === "production") return null;
  return (
    <section className="mt-12 w-full max-w-2xl rounded-panel border border-dashed border-line-strong bg-surface p-4">
      <h2 className="text-sm font-medium text-ink">Development: sample accounts</h2>
      <p className="mt-0.5 text-sm text-ink-muted">
        Created by <code className="font-mono text-xs">npm run db:seed</code>. Password for all:{" "}
        <code className="font-mono text-xs">{SAMPLE_PASSWORD}</code>. Not shown in production.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {SAMPLE_PEOPLE.map((person) => (
          <form key={person.key} action={devSignInAction}>
            <input type="hidden" name="phone" value={person.phone} />
            <button
              type="submit"
              className="w-full rounded-control border border-line px-3 py-2 text-left transition-colors hover:border-brand-500 hover:bg-brand-50"
            >
              <span className="block text-sm font-medium">{person.name}</span>
              <span className="block text-xs text-ink-muted">
                {person.roles.map((role) => ROLES[role].name).join(", ")} · {person.branch ?? "All branches"} ·{" "}
                {formatPhone(normalizePhone(person.phone))}
              </span>
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}
