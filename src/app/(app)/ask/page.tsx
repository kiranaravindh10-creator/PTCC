import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";

export const metadata: Metadata = { title: "Ask PTCC" };

// NOT IMPLEMENTED: Ask PTCC is Phase 7 (docs/SYSTEM_ARCHITECTURE.md §7).
export default function AskPage() {
  return (
    <PlannedModule
      title="Ask PTCC"
      phase={7}
      summary="Find things or get things done by asking in plain language."
      features={[
        "Answers only from information you are allowed to see",
        "Before changing anything, it shows exactly what it will do and asks you to confirm",
        "Knows PTCC's procedures, SOPs and policies once they are added",
      ]}
      examples={{
        heading: "You will be able to ask",
        items: [
          "Show my pending follow-ups",
          "Who is handling the Peenya pickup?",
          "What deals did marketing close this month?",
          "Assign tomorrow's Whitefield pickup to Arun",
        ],
      }}
    />
  );
}
