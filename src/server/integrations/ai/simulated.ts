import "server-only";
import type { CaptureProviders } from "@/modules/leads/capture";
import { extractByPattern, resolveRelativeDate } from "@/modules/leads/capture";
import type { CaptureLanguage, DetectedLanguage } from "@/modules/leads/model";
import type { IsoDate } from "@/lib/time";
import { CaptureProcessingError, ValidationError } from "@/server/errors";

/**
 * SIMULATED capture providers — development and automated tests only (never production;
 * see index.ts). Deterministic and honest:
 * - Photo and voice results come from a built-in SAMPLE the employee explicitly picks. The
 *   uploaded photo or recording is checked and fingerprinted, but NOT read — the review
 *   screen says so.
 * - Typed text: the built-in sample texts return their prepared fields; any other text gets
 *   only what a pattern can find for certain (phone, email, website, "tomorrow"…).
 * Sample companies, people and numbers are fictional (".example" addresses, 90000 900xx).
 */

type Sample = {
  key: string;
  label: string;
  language: DetectedLanguage;
  /** What the "provider" recognises. "" = nothing recognised. */
  text: string;
  /** Prepared fields for exactly this text. `followUpPhrase` is resolved against today. */
  extraction?: Record<string, unknown>;
  /** Simulates a provider failure with this message. */
  fails?: string;
};

export const PHOTO_SAMPLES: readonly Sample[] = [
  {
    key: "business-card",
    label: "Sample business card",
    language: "en",
    text: [
      "SRI LAKSHMI INDUSTRIES",
      "Ravi Kumar",
      "Maintenance Manager",
      "+91 90000 90001",
      "ravi.kumar@srilakshmi.example",
      "www.srilakshmi.example",
      "Plot 14, SIPCOT Phase II, Hosur 635109",
    ].join("\n"),
    extraction: {
      companyName: "Sri Lakshmi Industries",
      contactName: "Ravi Kumar",
      contactDesignation: "Maintenance Manager",
      contactPhone: "+91 90000 90001",
      contactEmail: "ravi.kumar@srilakshmi.example",
      companyWebsite: "www.srilakshmi.example",
      addressLine: "Plot 14, SIPCOT Phase II, Hosur 635109",
      area: "SIPCOT",
      city: "Hosur",
    },
  },
  {
    key: "company-board",
    label: "Sample company board",
    language: "en",
    text: ["KAVERI PRECISION FORGINGS PVT. LTD.", "No. 22, 2nd Stage, Peenya Industrial Area, Bengaluru 560058"].join("\n"),
    // A board shows a name and an address — no person, phone or email is invented.
    extraction: {
      companyName: "Kaveri Precision Forgings Pvt. Ltd.",
      addressLine: "No. 22, 2nd Stage, Peenya Industrial Area, Bengaluru 560058",
      area: "Peenya",
      city: "Bengaluru",
    },
  },
  {
    key: "blurred",
    label: "Blurred photo (simulates a failure)",
    language: "unknown",
    text: "",
    fails: "The photo is too blurred to read. Take it again in good light, or type the details instead.",
  },
];

export const VOICE_SAMPLES: Readonly<Record<CaptureLanguage, readonly Sample[]>> = {
  en: [
    {
      key: "en-visit",
      label: "Sample visit report (English)",
      language: "en",
      text: "I visited Deccan Gauges and Valves in Kukatpally today. I met Suresh, the quality manager. His number is 90000 90002. They want their pressure gauges calibrated. Please call him tomorrow.",
      extraction: {
        companyName: "Deccan Gauges and Valves",
        area: "Kukatpally",
        contactName: "Suresh",
        contactDesignation: "Quality Manager",
        contactPhone: "90000 90002",
        requirement: "Pressure gauge calibration",
        followUpPhrase: "tomorrow",
        serviceMentions: ["pressure gauge"],
      },
    },
    { key: "en-silence", label: "Nothing recognised (simulates a failure)", language: "en", text: "" },
  ],
  kn: [
    {
      key: "kn-visit",
      label: "Sample visit report (ಕನ್ನಡ)",
      language: "kn",
      text: "ಇವತ್ತು ಹೊಸೂರಿನ ಶ್ರೀ ಲಕ್ಷ್ಮಿ ಇಂಡಸ್ಟ್ರೀಸ್‌ಗೆ ಭೇಟಿ ನೀಡಿದೆ. ಮೇಂಟೆನೆನ್ಸ್ ಮ್ಯಾನೇಜರ್ ರವಿ ಅವರನ್ನು ಭೇಟಿಯಾದೆ. ಅವರ ನಂಬರ್ 90000 90001. ಅವರಿಗೆ ಟಾರ್ಕ್ ವ್ರೆಂಚ್ ಕ್ಯಾಲಿಬ್ರೇಶನ್ ಬೇಕು. ಮುಂದಿನ ಮಂಗಳವಾರ ಕರೆ ಮಾಡಬೇಕು.",
      extraction: {
        companyName: "Sri Lakshmi Industries",
        city: "Hosur",
        contactName: "Ravi",
        contactDesignation: "Maintenance Manager",
        contactPhone: "90000 90001",
        requirement: "Torque wrench calibration",
        followUpPhrase: "next tuesday",
        serviceMentions: ["torque wrench"],
      },
    },
    { key: "kn-silence", label: "Nothing recognised (simulates a failure)", language: "kn", text: "" },
  ],
  hi: [
    {
      key: "hi-visit",
      label: "Sample visit report (हिन्दी)",
      language: "hi",
      text: "आज मैं चेन्नई के अंबत्तूर में कावेरी पंप्स गया था। वहाँ के प्लांट इंजीनियर मुरुगन जी से मिला। उनका नंबर 90000 90003 है। उन्हें अपने तापमान सेंसर का कैलिब्रेशन करवाना है।",
      extraction: {
        companyName: "Kaveri Pumps",
        area: "Ambattur",
        city: "Chennai",
        contactName: "Murugan",
        contactDesignation: "Plant Engineer",
        contactPhone: "90000 90003",
        requirement: "Temperature sensor calibration",
        serviceMentions: ["temperature sensor"],
      },
    },
    { key: "hi-silence", label: "Nothing recognised (simulates a failure)", language: "hi", text: "" },
  ],
};

export const TEXT_SAMPLES: readonly Sample[] = [
  {
    key: "text-en",
    label: "English",
    language: "en",
    text: "Visited ABC Manufacturing in Hosur. Spoke to Ravi from maintenance. Interested in calibration services. Call him next Tuesday.",
    extraction: {
      companyName: "ABC Manufacturing",
      city: "Hosur",
      contactName: "Ravi",
      requirement: "Calibration services",
      notes: "Ravi is from the maintenance team.",
      followUpPhrase: "next tuesday",
      uncertain: ["contactName"],
    },
  },
  {
    key: "text-kn",
    label: "ಕನ್ನಡ",
    language: "kn",
    text: "ಪೀಣ್ಯದ ವಿನಾಯಕ ಎಂಜಿನಿಯರಿಂಗ್‌ನ ಮಂಜುನಾಥ್ ಅವರಿಗೆ ವರ್ನಿಯರ್ ಕ್ಯಾಲಿಪರ್ ಕ್ಯಾಲಿಬ್ರೇಶನ್ ಬೇಕು. ಫೋನ್ 90000 90004.",
    extraction: {
      companyName: "Vinayaka Engineering",
      area: "Peenya",
      contactName: "Manjunath",
      contactPhone: "90000 90004",
      requirement: "Vernier caliper calibration",
      serviceMentions: ["vernier caliper"],
    },
  },
  {
    key: "text-hi",
    label: "हिन्दी",
    language: "hi",
    text: "हैदराबाद की श्री साई टूल्स को वज़न तराज़ू का कैलिब्रेशन चाहिए। संपर्क: अनिल, 90000 90005, anil@saitools.example",
    extraction: {
      companyName: "Sri Sai Tools",
      city: "Hyderabad",
      contactName: "Anil",
      contactPhone: "90000 90005",
      contactEmail: "anil@saitools.example",
      requirement: "Weighing scale calibration",
      serviceMentions: ["weighing scale"],
    },
  },
];

const ALL_SAMPLES: readonly Sample[] = [...PHOTO_SAMPLES, ...Object.values(VOICE_SAMPLES).flat(), ...TEXT_SAMPLES];
const squash = (value: string) => value.replace(/\s+/g, " ").trim();

export function photoSample(key: string | null | undefined): Sample | null {
  return PHOTO_SAMPLES.find((sample) => sample.key === key) ?? null;
}

export function voiceSample(language: CaptureLanguage, key: string | null | undefined): Sample | null {
  return VOICE_SAMPLES[language].find((sample) => sample.key === key) ?? null;
}

export function sampleLabel(key: string | null | undefined): string | null {
  return ALL_SAMPLES.find((sample) => sample.key === key)?.label ?? null;
}

/** The prepared fields for a sample text, with "when" words turned into an explicit date. */
function sampleExtraction(sample: Sample, today: IsoDate): Record<string, unknown> {
  const fields = { ...sample.extraction };
  const phrase = typeof fields.followUpPhrase === "string" ? fields.followUpPhrase : null;
  if (phrase) {
    const resolved = resolveRelativeDate(phrase, today);
    if (resolved) fields.followUpDate = resolved.date;
    else delete fields.followUpPhrase;
  }
  return fields;
}

export function simulatedProviders(options: { sample?: string | null }): CaptureProviders {
  return {
    vision: {
      async read() {
        const sample = photoSample(options.sample);
        if (!sample) throw new ValidationError("Choose which sample result to simulate.", { sample: "Choose a sample." });
        if (sample.fails) throw new CaptureProcessingError(sample.fails);
        return { text: sample.text, language: sample.language };
      },
    },
    speech: {
      async transcribe({ languageHint }) {
        const language = languageHint ?? "en";
        const sample = voiceSample(language, options.sample);
        if (!sample) throw new ValidationError("Choose which sample transcript to simulate.", { sample: "Choose a sample." });
        if (sample.fails) throw new CaptureProcessingError(sample.fails);
        return { text: sample.text, language: sample.language };
      },
    },
    extractor: {
      async extract({ text, today }) {
        const sample = ALL_SAMPLES.find((candidate) => candidate.extraction && squash(candidate.text) === squash(text));
        return sample ? sampleExtraction(sample, today) : extractByPattern(text, today);
      },
    },
  };
}
