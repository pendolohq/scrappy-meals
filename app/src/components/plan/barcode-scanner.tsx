"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageUp, ScanLine, X } from "lucide-react";

import { Button, buttonClass } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  confirmRead,
  createDetector,
  isScannerFailure,
  loadPhoto,
  type Detector,
} from "@/lib/barcode-scanner";
import { parseBarcode } from "@/server/domain/barcode";

// How often a frame is read. One detection at a time, so a slow phone just
// reads less often.
const FRAME_MS = 150;

const BLOCKED =
  "Camera blocked: allow it in the browser's settings, or take a photo / type the digits.";
const NO_CAMERA = "No camera found: take a photo or type the digits.";
const UNSUPPORTED =
  "This browser can't scan here: take a photo or type the digits.";
const SCANNER_FAILED =
  "The scanner couldn't load: check your connection and try again, or type the digits.";
const NO_BARCODE = "No barcode in that photo: try closer, in good light.";

const cameraProblem = (e: unknown) => {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return BLOCKED;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return NO_CAMERA;
  }
  return "The camera wouldn't start: take a photo or type the digits.";
};

/**
 * A "Scan" button that opens the camera in a dialog and calls `onCode` with
 * the first barcode it reads twice running. "Take a photo" does the same from
 * a picture, which needs no camera permission.
 */
export const BarcodeScanner = ({
  onCode,
  disabled,
  className,
}: {
  onCode: (barcode: string) => void;
  disabled?: boolean;
  className?: string;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  // One detector for the camera and the photo, made when first needed.
  const detector = useRef<Promise<Detector>>(undefined);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState(false);
  // The last photo's result, apart from the camera's status: the camera
  // restarts when the page comes back from the camera app, and its messages
  // must not replace this one.
  const [photoNote, setPhotoNote] = useState<{ text: string; ok: boolean }>();

  const say = (text: string, isProblem = false) => {
    setMessage(text);
    setProblem(isProblem);
  };
  const getDetector = () => (detector.current ??= createDetector());

  const close = () => dialog.current?.close();
  const found = (code: string) => {
    close();
    onCode(code);
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    // Starts the camera and reads frames until stopped; returns the stopper.
    const startCamera = () => {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stream: MediaStream | undefined;
      const stop = () => {
        stopped = true;
        clearTimeout(timer);
        stream?.getTracks().forEach((t) => t.stop());
        // A later start may be using the same <video> already.
        if (video.current && video.current.srcObject === stream) {
          video.current.srcObject = null;
        }
      };
      const sayNow = (text: string, isProblem = false) => {
        if (!stopped) {
          say(text, isProblem);
        }
      };

      const run = async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          sayNow(UNSUPPORTED, true);
          return;
        }
        sayNow("Starting the camera…");
        // Loads while the permission prompt is up.
        const loading = getDetector();
        loading.catch(() => {
          if (detector.current === loading) {
            detector.current = undefined;
          }
        });
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
          });
        } catch (e) {
          sayNow(cameraProblem(e), true);
          return;
        }
        if (stopped) {
          stop(); // closed while the permission prompt was up
          return;
        }
        const el = video.current;
        if (!el) {
          stop();
          return;
        }
        el.srcObject = stream;
        // A track the system ends (camera taken by another app) or mutes
        // would leave a frozen frame that reads nothing.
        const lost = () => {
          if (!stopped) {
            sayNow(
              "The camera stopped: close this and scan again, or take a photo.",
              true
            );
            stop();
          }
        };
        stream.getVideoTracks().forEach((t) => {
          t.addEventListener("ended", lost);
          t.addEventListener("mute", lost);
        });
        await el.play().catch(() => undefined);

        let reader: Detector;
        try {
          reader = await loading;
        } catch {
          sayNow(SCANNER_FAILED, true);
          stop();
          return;
        }
        sayNow("Point the camera at the barcode.");

        let previous: string | null = null;
        const tick = async () => {
          if (stopped) {
            return;
          }
          if (el.readyState >= 2) {
            try {
              const read = confirmRead(
                previous,
                (await reader.detect(el)).map((b) => b.rawValue)
              );
              previous = read.previous;
              if (read.confirmed !== null && !stopped) {
                stop();
                found(read.confirmed);
                return;
              }
            } catch (e) {
              if (isScannerFailure(e)) {
                // The wasm didn't load: every frame would fail the same way.
                detector.current = undefined;
                sayNow(SCANNER_FAILED, true);
                stop();
                return;
              }
              // Any other frame that can't be read is just skipped.
            }
          }
          if (!stopped) {
            timer = setTimeout(tick, FRAME_MS);
          }
        };
        void tick();
      };

      void run();
      return stop;
    };

    let stopCamera: (() => void) | undefined = startCamera();
    // A hidden page (switched app, locked phone, the camera app taking a
    // photo) mustn't keep the camera on, but the dialog stays for the photo.
    const onVisibility = () => {
      if (document.hidden) {
        stopCamera?.();
        stopCamera = undefined;
      } else if (!stopCamera) {
        stopCamera = startCamera();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopCamera?.();
    };
    // `found` only calls props and refs that don't change what the camera does.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const readPhoto = async (file: File) => {
    const fail = (text: string) => setPhotoNote({ text, ok: false });
    setPhotoNote({ text: "Reading the photo…", ok: true });
    let bitmap: ImageBitmap;
    try {
      bitmap = await loadPhoto(file);
    } catch {
      fail(
        "This browser can't open that photo (HEIC, say): try another, or type the digits."
      );
      return;
    }
    try {
      let reader: Detector;
      try {
        reader = await getDetector();
      } catch {
        detector.current = undefined;
        fail(SCANNER_FAILED);
        return;
      }
      let raw: { rawValue: string }[];
      try {
        raw = await reader.detect(bitmap);
      } catch (e) {
        if (isScannerFailure(e)) {
          detector.current = undefined;
          fail(SCANNER_FAILED);
        } else {
          fail(NO_BARCODE);
        }
        return;
      }
      const code = raw
        .map((b) => parseBarcode(b.rawValue))
        .find((c) => c !== null);
      if (code) {
        found(code);
      } else {
        fail(NO_BARCODE);
      }
    } finally {
      bitmap.close();
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        className={className}
        disabled={disabled}
        onClick={() => {
          setMessage("");
          setProblem(false);
          setPhotoNote(undefined);
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <ScanLine className="size-5" aria-hidden />
        Scan
      </Button>
      <dialog
        ref={dialog}
        aria-label="Scan a barcode"
        onClose={(e) => {
          // React bubbles `close` to the Add dialog around this one, which
          // would take it for its own closing.
          e.stopPropagation();
          setOpen(false);
        }}
        className="m-auto w-[min(26rem,calc(100vw-1rem))] rounded-card border border-border bg-card p-0 text-foreground shadow-raised backdrop:bg-scrim/40"
      >
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-serif text-heading font-semibold">
              Scan a barcode
            </h2>
            <IconButton label="Close" className="-mr-2" onClick={close}>
              <X className="size-5" aria-hidden />
            </IconButton>
          </div>
          {/* The picture is only a viewfinder; the message below is the text. */}
          <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-sunken">
            <Camera
              className="absolute inset-0 m-auto size-10 text-muted/60"
              aria-hidden
            />
            <video
              ref={video}
              playsInline
              muted
              autoPlay
              aria-hidden
              className="relative size-full object-cover"
            />
          </div>
          <output
            className={
              problem ? "block text-sm text-danger" : "block text-sm text-muted"
            }
          >
            {message}
          </output>
          {photoNote && (
            <output
              className={
                photoNote.ok
                  ? "block text-sm text-muted"
                  : "block text-sm text-danger"
              }
            >
              {photoNote.text}
            </output>
          )}
          <label
            className={`${buttonClass({ variant: "secondary", block: true })} cursor-pointer has-[:focus-visible]:outline-2`}
          >
            <ImageUp className="size-5" aria-hidden />
            Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // the same picture can be tried again
                if (file) {
                  void readPhoto(file);
                }
              }}
            />
          </label>
        </div>
      </dialog>
    </>
  );
};
