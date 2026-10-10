"use client";

import { Camera, ImageUp, Mic, RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Choice, Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/display";
import { cn } from "@/lib/format";
import type { SampleOption } from "@/server/integrations/ai";
import type { CaptureView } from "../../capture-service";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_RECORDING_SECONDS, MAX_TEXT_LENGTH } from "../../capture-limits";
import { CAPTURE_LANGUAGES, LANGUAGE_LABEL, LANGUAGE_NATIVE, type CaptureLanguage } from "../../model";
import { useRecorder } from "./use-recorder";

/** The three ways to capture a lead. Each sends the capture for reading and hands back a draft. */

type CaptureResult = { ok: true; capture: CaptureView } | { ok: false; message: string };

/** Sends a capture to the server for reading. Returns a draft to review, or a plain message. */
export async function submitCapture(form: FormData): Promise<CaptureResult> {
  let response: Response;
  try {
    response = await fetch("/api/capture", { method: "POST", body: form });
  } catch {
    return { ok: false, message: "Couldn't reach PTCC. Check your connection and try again." };
  }
  let data: { status?: string; capture?: CaptureView; message?: string; error?: string } | null = null;
  try {
    data = await response.json();
  } catch {
    // Not JSON — handled below.
  }
  if (response.ok && data?.status === "ready" && data.capture) return { ok: true, capture: data.capture };
  if (response.status === 401) return { ok: false, message: "You've been signed out. Sign in again, then retry." };
  if (response.status === 413) return { ok: false, message: "That file is too large." };
  return { ok: false, message: data?.message ?? data?.error ?? "Something went wrong. Try again, or type the details instead." };
}

function StepActions({ onBack, primary }: { onBack: () => void; primary: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-3 border-t border-line pt-5">
      {primary}
      <button type="button" onClick={onBack} className={buttonClasses("ghost", "lg", "max-sm:w-full")}>
        Back
      </button>
    </div>
  );
}

function SamplePicker({
  name,
  samples,
  value,
  onChange,
  what,
}: {
  name: string;
  samples: SampleOption[];
  value: string;
  onChange: (value: string) => void;
  what: string;
}) {
  return (
    <div className="space-y-2 rounded-panel border border-dashed border-warning-700/40 bg-warning-50/40 p-3">
      <Choice name={name} legend="Simulated result to use" options={samples.map((s) => ({ value: s.key, label: s.label }))} value={value} onChange={onChange} />
      <p className="text-xs text-ink-muted">Development only: the result comes from this sample, not from {what}.</p>
    </div>
  );
}

// ─── Photo ──────────────────────────────────────────────────────────────────────

export function PhotoStep({
  samples,
  onCaptured,
  onBack,
}: {
  samples: SampleOption[] | null;
  onCaptured: (capture: CaptureView) => void;
  onBack: () => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [sample, setSample] = useState(samples?.[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Free the preview when it's replaced or the step closes.
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  const choose = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setError("Use a JPEG, PNG or WebP photo.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("This photo is too large (over 8 MB). Take it again, or choose a smaller one.");
      return;
    }
    setError(null);
    setPhoto({ file, url: URL.createObjectURL(file) });
  };

  const read = async () => {
    if (!photo) {
      setError("Take or upload a photo first.");
      return;
    }
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("method", "photo");
    if (samples) form.set("sample", sample);
    form.set("file", photo.file);
    const result = await submitCapture(form);
    setPending(false);
    if (result.ok) onCaptured(result.capture);
    else setError(result.message);
  };

  const accept = IMAGE_TYPES.join(",");
  return (
    <section aria-labelledby="photo-heading" className="space-y-5">
      <div>
        <h2 id="photo-heading" className="text-lg font-semibold">
          Photo of a business card or company board
        </h2>
        <p className="text-sm text-ink-muted">Hold the phone steady, in good light. The photo is not stored — only the details you confirm.</p>
      </div>
      <input ref={camera} type="file" accept={accept} capture="environment" className="sr-only" tabIndex={-1} onChange={choose} aria-label="Take photo" />
      <input ref={upload} type="file" accept={accept} className="sr-only" tabIndex={-1} onChange={choose} aria-label="Upload photo" />
      {photo ? (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL), not a served image */}
          <img src={photo.url} alt="The photo you chose" className="max-h-72 w-full rounded-panel border border-line bg-subtle object-contain" />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => camera.current?.click()} className={buttonClasses("secondary", "md")}>
              <RotateCcw aria-hidden />
              Replace
            </button>
            <button type="button" onClick={() => setPhoto(null)} className={buttonClasses("ghost", "md")}>
              <Trash2 aria-hidden />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => camera.current?.click()} className={buttonClasses("primary", "lg")}>
            <Camera aria-hidden />
            Take photo
          </button>
          <button type="button" onClick={() => upload.current?.click()} className={buttonClasses("secondary", "lg")}>
            <ImageUp aria-hidden />
            Upload photo
          </button>
        </div>
      )}
      {samples && <SamplePicker name="photo-sample" samples={samples} value={sample} onChange={setSample} what="your photo" />}
      {error && <Notice tone="danger">{error}</Notice>}
      <StepActions
        onBack={onBack}
        primary={
          <button type="button" onClick={read} disabled={pending || !photo} className={buttonClasses("primary", "lg", "max-sm:w-full")}>
            {pending ? "Reading…" : "Read photo"}
          </button>
        }
      />
    </section>
  );
}

// ─── Voice ──────────────────────────────────────────────────────────────────────

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function VoiceStep({
  samples,
  onCaptured,
  onBack,
}: {
  samples: Record<CaptureLanguage, SampleOption[]> | null;
  onCaptured: (capture: CaptureView) => void;
  onBack: () => void;
}) {
  const recorder = useRecorder(MAX_RECORDING_SECONDS);
  const [language, setLanguage] = useState<CaptureLanguage>("en");
  const [sample, setSample] = useState(samples?.en[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { state } = recorder;
  const recording = state.status === "recording" || state.status === "requesting";
  const recorded = state.status === "recorded" ? state : null;
  const canSend = !pending && !recording && (Boolean(recorded) || Boolean(samples));

  const changeLanguage = (value: string) => {
    const next = value as CaptureLanguage;
    setLanguage(next);
    if (samples) setSample(samples[next][0]?.key ?? "");
  };

  const transcribe = async () => {
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("method", "voice");
    form.set("language", language);
    if (samples) form.set("sample", sample);
    if (recorded) form.set("file", new File([recorded.blob], "recording", { type: recorded.blob.type }));
    const result = await submitCapture(form);
    setPending(false);
    if (result.ok) onCaptured(result.capture);
    else setError(result.message);
  };

  return (
    <section aria-labelledby="voice-heading" className="space-y-5">
      <div>
        <h2 id="voice-heading" className="text-lg font-semibold">
          Speak the lead details
        </h2>
        <p className="text-sm text-ink-muted">
          Say the company, who you met, their number and what they need — naturally, in any of these languages. The recording is not stored.
        </p>
      </div>
      <Choice
        name="language"
        legend="Language"
        options={CAPTURE_LANGUAGES.map((code) => ({ value: code, label: code === "en" ? "English" : `${LANGUAGE_NATIVE[code]} · ${LANGUAGE_LABEL[code]}` }))}
        value={language}
        onChange={changeLanguage}
      />

      <div className="space-y-3 rounded-panel border border-line bg-surface p-4">
        {recorder.supported === false ? (
          <p className="text-sm text-ink-muted">This browser can&apos;t record audio. Type the details instead{samples ? ", or use a simulated sample below" : ""}.</p>
        ) : state.status === "recording" ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 font-medium text-danger-700" role="status">
              <span className="size-2.5 animate-pulse rounded-full bg-danger-700" aria-hidden />
              Recording {clock(state.seconds)}
              <span className="font-normal text-ink-subtle">/ {clock(recorder.maxSeconds)}</span>
            </span>
            <button type="button" onClick={recorder.stop} className={buttonClasses("primary", "md")}>
              <Square aria-hidden />
              Stop
            </button>
            <button type="button" onClick={recorder.cancel} className={buttonClasses("ghost", "md")}>
              Cancel
            </button>
          </div>
        ) : recorded ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Recorded {clock(recorded.seconds)}</p>
            <audio controls src={recorded.url} className="w-full" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={recorder.start} className={buttonClasses("secondary", "md")}>
                <RotateCcw aria-hidden />
                Record again
              </button>
              <button type="button" onClick={recorder.cancel} className={buttonClasses("ghost", "md")}>
                <Trash2 aria-hidden />
                Discard
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={recorder.start}
            disabled={state.status === "requesting" || recorder.supported === null}
            className={buttonClasses("primary", "lg", "w-full sm:w-auto")}
          >
            <Mic aria-hidden />
            {state.status === "requesting" ? "Allow the microphone…" : "Start recording"}
          </button>
        )}
        {state.status === "error" && <p className="text-sm text-danger-700" role="alert">{state.message}</p>}
      </div>

      {samples && (
        <SamplePicker name="voice-sample" samples={samples[language]} value={sample} onChange={setSample} what="your recording" />
      )}
      {samples && !recorded && <p className="text-sm text-ink-muted">No microphone? You can use the simulated sample without recording.</p>}
      {error && <Notice tone="danger">{error}</Notice>}
      <StepActions
        onBack={onBack}
        primary={
          <button type="button" onClick={transcribe} disabled={!canSend} className={buttonClasses("primary", "lg", "max-sm:w-full")}>
            {pending ? "Transcribing…" : "Transcribe"}
          </button>
        }
      />
    </section>
  );
}

// ─── Typed ──────────────────────────────────────────────────────────────────────

export function TextStep({
  samples,
  onCaptured,
  onBack,
}: {
  samples: SampleOption[] | null;
  onCaptured: (capture: CaptureView) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const read = async () => {
    if (text.trim().length < 3) {
      setError("Describe the lead in a few words first.");
      return;
    }
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("method", "text");
    form.set("text", text);
    const result = await submitCapture(form);
    setPending(false);
    if (result.ok) onCaptured(result.capture);
    else setError(result.message);
  };

  return (
    <section aria-labelledby="text-heading" className="space-y-5">
      <div>
        <h2 id="text-heading" className="text-lg font-semibold">
          Describe the lead
        </h2>
        <p className="text-sm text-ink-muted">In English, ಕನ್ನಡ or हिन्दी — the way you&apos;d tell a colleague.</p>
      </div>
      <Field id="capture-text" label="What happened?" hint="e.g. Visited ABC Manufacturing in Hosur. Spoke to Ravi from maintenance. Call him next Tuesday.">
        <Textarea
          id="capture-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          maxLength={MAX_TEXT_LENGTH}
          aria-describedby="capture-text-hint"
        />
      </Field>
      {samples && (
        <div className="space-y-2 rounded-panel border border-dashed border-warning-700/40 bg-warning-50/40 p-3">
          <p className="text-sm font-medium">Try a sample</p>
          <div className="flex flex-wrap gap-2">
            {samples.map((sample) => (
              <button key={sample.key} type="button" onClick={() => setText(sample.text ?? "")} className={cn(buttonClasses("secondary", "sm"))}>
                {sample.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-muted">
            Development only: the samples have prepared results. For your own text, only phone numbers, email addresses, websites
            and words like &ldquo;tomorrow&rdquo; are picked out — fill in the rest yourself.
          </p>
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <StepActions
        onBack={onBack}
        primary={
          <button type="button" onClick={read} disabled={pending} className={buttonClasses("primary", "lg", "max-sm:w-full")}>
            {pending ? "Reading…" : "Read details"}
          </button>
        }
      />
    </section>
  );
}
