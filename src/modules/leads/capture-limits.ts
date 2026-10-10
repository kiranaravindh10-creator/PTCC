/** Limits shared by the capture screen (early feedback) and the server (which enforces them). */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac"] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 2000;
/** Longest recording the screen allows. */
export const MAX_RECORDING_SECONDS = 120;
