"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Microphone recording for voice capture (browser MediaRecorder). Handles: no browser
 * support, microphone blocked or missing, cancelling, failed and empty recordings, and a
 * maximum length. The recording stays in the browser until the employee sends it.
 */

export type RecorderState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "recording"; seconds: number }
  | { status: "recorded"; blob: Blob; seconds: number; url: string }
  | { status: "error"; message: string };

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

const subscribeNothing = () => () => {};
const browserSupport = () =>
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";

export function useRecorder(maxSeconds = 120) {
  /** null while rendering on the server (unknown), then true/false in the browser. */
  const supported = useSyncExternalStore(subscribeNothing, browserSupport, () => null);
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const chunks = useRef<Blob[]>([]);
  const seconds = useRef(0);
  const discard = useRef(false);
  const objectUrl = useRef<string | null>(null);

  const release = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  const forgetUrl = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);

  useEffect(
    () => () => {
      discard.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
      forgetUrl();
    },
    [release, forgetUrl],
  );

  const start = useCallback(async () => {
    forgetUrl();
    setState({ status: "requesting" });
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setState({
        status: "error",
        message:
          name === "NotAllowedError" || name === "SecurityError"
            ? "Microphone access is blocked. Allow the microphone for PTCC in your browser settings — or type the details instead."
            : name === "NotFoundError"
              ? "No microphone was found on this device. Type the details instead."
              : "The microphone couldn't be started. Try again, or type the details instead.",
      });
      return;
    }
    const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
    let instance: MediaRecorder;
    try {
      instance = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
    } catch {
      media.getTracks().forEach((track) => track.stop());
      setState({ status: "error", message: "Recording isn't supported in this browser. Type the details instead." });
      return;
    }
    stream.current = media;
    recorder.current = instance;
    chunks.current = [];
    seconds.current = 0;
    discard.current = false;
    instance.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    instance.onerror = () => {
      discard.current = true;
      release();
      setState({ status: "error", message: "Recording failed. Try again, or type the details instead." });
    };
    instance.onstop = () => {
      release();
      if (discard.current) {
        setState((current) => (current.status === "error" ? current : { status: "idle" }));
        return;
      }
      const blob = new Blob(chunks.current, { type: instance.mimeType || mimeType || "audio/webm" });
      if (blob.size === 0) {
        setState({ status: "error", message: "Nothing was recorded. Try again." });
        return;
      }
      objectUrl.current = URL.createObjectURL(blob);
      setState({ status: "recorded", blob, seconds: seconds.current, url: objectUrl.current });
    };
    instance.start(1000);
    setState({ status: "recording", seconds: 0 });
    timer.current = window.setInterval(() => {
      seconds.current += 1;
      setState({ status: "recording", seconds: seconds.current });
      if (seconds.current >= maxSeconds && instance.state === "recording") instance.stop();
    }, 1000);
  }, [forgetUrl, maxSeconds, release]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discard.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    else {
      release();
      forgetUrl();
      setState({ status: "idle" });
    }
  }, [forgetUrl, release]);

  return { supported, state, start, stop, cancel, maxSeconds };
}
