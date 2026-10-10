"use client";

import { Camera, Keyboard, Mic } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/display";
import { cn } from "@/lib/format";
import type { CaptureAvailability, SampleOption } from "@/server/integrations/ai";
import type { CaptureView } from "../../capture-service";
import type { CaptureLanguage } from "../../model";
import { CaptureReview } from "./capture-review";
import { PhotoStep, TextStep, VoiceStep } from "./capture-steps";

type Step = "choose" | "photo" | "voice" | "text" | "review";

type Samples = { photo: SampleOption[]; voice: Record<CaptureLanguage, SampleOption[]>; text: SampleOption[] } | null;

/**
 * Capture a lead: choose photo, voice or text → it is read → the employee reviews and
 * confirms. Only the confirmation creates a lead.
 */
export function CaptureFlow({
  availability,
  samples,
  branches,
  allBranches,
  defaultBranchId,
  marketersByBranch,
  actorId,
  initialCapture,
}: {
  availability: CaptureAvailability;
  samples: Samples;
  /** Branches this person may put a new lead in. */
  branches: { id: string; name: string }[];
  /** Every active branch — only to recognise a branch the capture names. */
  allBranches: { id: string; name: string }[];
  defaultBranchId: string;
  marketersByBranch: Record<string, { id: string; name: string }[]> | null;
  actorId: string;
  initialCapture: CaptureView | null;
}) {
  const [step, setStep] = useState<Step>(initialCapture ? "review" : "choose");
  const [capture, setCapture] = useState<CaptureView | null>(initialCapture);

  const captured = (next: CaptureView) => {
    setCapture(next);
    setStep("review");
    // A refresh during review comes back to the same draft.
    window.history.replaceState(null, "", `/leads/capture?capture=${next.id}`);
    window.scrollTo({ top: 0 });
  };
  const back = () => setStep("choose");

  if (availability.mode === "off") {
    return (
      <div className="max-w-2xl space-y-4">
        <Notice tone="info" title="Capturing from a photo or voice isn't available yet">
          Reading photos and speech needs a recognition service that PTCC hasn&apos;t connected yet. Until then, add the lead with the
          form — it takes a minute.
        </Notice>
        <ButtonLink href="/leads/new" variant="primary">
          Add lead with the form
        </ButtonLink>
      </div>
    );
  }

  if (step === "review" && capture) {
    return (
      <div className="max-w-2xl">
        <CaptureReview
          capture={capture}
          branches={branches}
          allBranches={allBranches}
          defaultBranchId={defaultBranchId}
          marketersByBranch={marketersByBranch}
          actorId={actorId}
        />
      </div>
    );
  }

  if (step === "photo") {
    return (
      <div className="max-w-2xl">
        <PhotoStep samples={samples?.photo ?? null} onCaptured={captured} onBack={back} />
      </div>
    );
  }
  if (step === "voice") {
    return (
      <div className="max-w-2xl">
        <VoiceStep samples={samples?.voice ?? null} onCaptured={captured} onBack={back} />
      </div>
    );
  }
  if (step === "text") {
    return (
      <div className="max-w-2xl">
        <TextStep samples={samples?.text ?? null} onCaptured={captured} onBack={back} />
      </div>
    );
  }

  const options = [
    { key: "photo" as const, icon: Camera, title: "Photo", detail: "Business card or company board", enabled: availability.photo },
    { key: "voice" as const, icon: Mic, title: "Speak", detail: "English · ಕನ್ನಡ · हिन्दी", enabled: availability.voice },
    { key: "text" as const, icon: Keyboard, title: "Type", detail: "Describe it in your own words", enabled: availability.text },
  ];
  return (
    <div className="max-w-2xl space-y-5">
      {availability.simulated && (
        <Notice tone="warning" title="Simulated capture (development)">
          No recognition service is connected. Photo and voice results come from built-in samples — not from your photo or voice.
          Everything is labelled as simulated.
        </Notice>
      )}
      <h2 className="text-lg font-semibold">How do you want to capture it?</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {options.map(({ key, icon: Icon, title, detail, enabled }) => (
          <button
            key={key}
            type="button"
            disabled={!enabled}
            onClick={() => setStep(key)}
            className={cn(
              "flex min-h-24 items-center gap-4 rounded-panel border border-line bg-surface px-4 py-4 text-left transition-colors duration-150 sm:flex-col sm:items-start sm:gap-3",
              "hover:border-brand-500 hover:bg-brand-50/50 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <Icon className="size-5" aria-hidden />
            </span>
            <span>
              <span className="block font-semibold">{title}</span>
              <span className="block text-sm text-ink-muted">{enabled ? detail : "Not available yet"}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-sm text-ink-muted">
        You&apos;ll check every detail before anything is saved.{" "}
        <Link href="/leads/new" className="font-medium text-brand-600 hover:text-brand-700">
          Or fill in the full form
        </Link>
        .
      </p>
    </div>
  );
}
