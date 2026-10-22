"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageUp, ScanLine, X } from "lucide-react";

import { Button, buttonClass } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  CAMERA,
  cameraProblem,
  confirmRead,
  createReaderSource,
  firstBarcode,
  isScannerFailure,
  loadPhoto,
  type Reader,
} from "@/lib/barcode-scanner";

// How often a frame is read. One detection at a time, so a slow phone just
// reads less often.
const FRAME_MS = 150;

const UNSUPPORTED =
  "This browser can't scan here: take a photo or type the digits.";
const SCANNER_FAILED =
  "The scanner couldn't load: check your connection and try again, or type the digits.";
const NO_BARCODE = "No barcode in that photo: try closer, in good light.";
const AIMING = "Point the camera at the barcode.";

// One reader for the page: closing the scanner and opening it again (back
// from a product) reuses the compiled wasm.
const readers = createReaderSource();

type Note = { text: string; problem: boolean };

const noteClass = (note?: Note) =>
  note?.problem ? "block text-sm text-danger" : "block text-sm text-muted";

/** Asks a camera that can for continuous autofocus; others keep their own. */
const keepFocusing = (track: MediaStreamTrack) => {
  const caps = track.getCapabilities?.() as
    | { focusMode?: string[] }
    | undefined;
  const modes = caps?.focusMode;
  if (modes?.includes("continuous")) {
    track
      .applyConstraints({
        advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
      })
      .catch(() => undefined);
  }
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
  // Bumped whenever the dialog opens or closes, so a read that finishes
  // after that (a photo still decoding) can tell it's no longer wanted.
  const session = useRef(0);
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState<Note>();
  // The last photo's result, apart from the camera's status: the camera
  // restarts when the page comes back from the camera app, and its messages
  // must not replace this one.
  const [photo, setPhoto] = useState<Note>();

  const close = () => dialog.current?.close();
  /** Hands over the code once per opening, whichever read got there first. */
  const found = (code: string, from: number) => {
    if (from !== session.current) {
      return;
    }
    session.current += 1;
    close();
    onCode(code);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const opened = session.current;

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
      const say = (text: string, problem = false) => {
        if (!stopped) {
          setCamera({ text, problem });
        }
      };

      const run = async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          say(UNSUPPORTED, true);
          return;
        }
        say("Starting the camera…");
        // Loads while the permission prompt is up.
        let loading = readers.get();
        const first = loading;
        first.catch(() => readers.drop(first));
        try {
          stream = await navigator.mediaDevices.getUserMedia(CAMERA);
        } catch (e) {
          say(cameraProblem(e), true);
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
        stream.getVideoTracks().forEach((t) => {
          keepFocusing(t);
          // Taken by another app for good: a frozen frame would read nothing.
          t.addEventListener("ended", () => {
            say(
              "The camera stopped: close this and scan again, or take a photo.",
              true
            );
            stop();
          });
          // Interrupted for a moment (the system camera for a photo, a call):
          // frames resume on their own.
          t.addEventListener("mute", () => say("The camera is paused…"));
          t.addEventListener("unmute", () => say(AIMING));
        });
        await el.play().catch(() => undefined);

        let reader: Reader;
        try {
          reader = await loading;
        } catch {
          say(SCANNER_FAILED, true);
          stop();
          return;
        }
        say(AIMING);

        let previous: string | null = null;
        const tick = async () => {
          if (stopped) {
            return;
          }
          if (el.readyState >= 2) {
            try {
              const read = confirmRead(previous, await reader.detect(el));
              previous = read.previous;
              if (read.confirmed !== null && !stopped) {
                stop();
                found(read.confirmed, opened);
                return;
              }
            } catch (e) {
              if (isScannerFailure(e)) {
                readers.drop(loading, reader);
                if (!reader.native) {
                  say(SCANNER_FAILED, true);
                  stop();
                  return;
                }
                // The wasm reader takes over from a native one that broke.
                loading = readers.get();
                try {
                  reader = await loading;
                } catch {
                  readers.drop(loading);
                  say(SCANNER_FAILED, true);
                  stop();
                  return;
                }
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
    const from = session.current;
    // Nothing is shown once the scanner has closed or found a code.
    const note = (text: string, problem = true) => {
      if (from === session.current) {
        setPhoto({ text, problem });
      }
    };
    note("Reading the photo…", false);
    let bitmap: ImageBitmap;
    try {
      bitmap = await loadPhoto(file);
    } catch {
      note(
        "This browser can't open that photo (HEIC, say): try another, or type the digits."
      );
      return;
    }
    // A native detector that broke gets one retry, on the wasm reader.
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const loading = readers.get();
        let reader: Reader;
        try {
          reader = await loading;
        } catch {
          readers.drop(loading);
          note(SCANNER_FAILED);
          return;
        }
        try {
          const code = firstBarcode(await reader.detect(bitmap));
          if (code) {
            found(code, from);
          } else {
            note(NO_BARCODE);
          }
          return;
        } catch (e) {
          if (!isScannerFailure(e)) {
            note(NO_BARCODE);
            return;
          }
          readers.drop(loading, reader);
          if (!reader.native) {
            note(SCANNER_FAILED);
            return;
          }
        }
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
          session.current += 1;
          setCamera(undefined);
          setPhoto(undefined);
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
          session.current += 1;
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
          {/* Always there, so a screen reader hears the first message too. */}
          <output className={noteClass(camera)}>{camera?.text}</output>
          {photo && <output className={noteClass(photo)}>{photo.text}</output>}
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
