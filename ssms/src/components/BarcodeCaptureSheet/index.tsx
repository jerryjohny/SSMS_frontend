import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  ChecksumException,
  DecodeHintType,
  FormatException,
  NotFoundException,
} from "@zxing/library";
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18nContext";
import "./styles.css";

interface BarcodeCaptureSheetProps {
  open: boolean;
  title: string;
  eyebrow?: string;
  onClose: () => void;
  onDetected: (barcode: string) => void;
}

const SCANNER_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" } },
  audio: false,
};

const FALLBACK_SCANNER_CONSTRAINTS: MediaStreamConstraints = {
  video: true,
  audio: false,
};

const SCANNER_HINTS = new Map<DecodeHintType, BarcodeFormat[]>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.QR_CODE,
    ],
  ],
]);

export default function BarcodeCaptureSheet({
  open,
  title,
  eyebrow,
  onClose,
  onDetected,
}: BarcodeCaptureSheetProps) {
  const { copy } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const detectedRef = useRef(false);
  const [manualValue, setManualValue] = useState("");
  const [cameraMode, setCameraMode] = useState<"camera" | "manual">("camera");
  const [status, setStatus] = useState<string>(copy.sellerHome.scannerPosition);

  const detachVideoStream = useCallback(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.pause();
    videoRef.current.srcObject = null;
    videoRef.current.removeAttribute("src");
  }, []);

  const cleanupScanner = useCallback(() => {
    detectedRef.current = false;

    if (readerRef.current) {
      readerRef.current.stopContinuousDecode();
      readerRef.current.reset();
      readerRef.current = null;
    }

    detachVideoStream();
  }, [detachVideoStream]);

  useEffect(() => {
    setStatus(copy.sellerHome.scannerPosition);
  }, [copy.sellerHome.scannerPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      cleanupScanner();
      return;
    }

    if (!window.isSecureContext) {
      setCameraMode("manual");
      setStatus(copy.sellerHome.scannerRequiresSecureOrigin);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMode("manual");
      setStatus(copy.sellerHome.scannerUnsupported);
      return;
    }

    let cancelled = false;
    detectedRef.current = false;
    setCameraMode("camera");
    setManualValue("");
    setStatus(copy.sellerHome.scannerPosition);

    async function startReaderWithConstraints(
      constraints: MediaStreamConstraints,
      reader: BrowserMultiFormatReader
    ) {
      if (!videoRef.current) {
        throw new Error("Scanner video element is not available.");
      }

      readerRef.current = reader;

      await reader.decodeFromConstraints(
        constraints,
        videoRef.current,
        (result, error) => {
          if (detectedRef.current) {
            return;
          }

          if (result) {
            detectedRef.current = true;
            reader.stopContinuousDecode();
            reader.reset();
            readerRef.current = null;
            detachVideoStream();
            onDetected(result.getText().trim());
            return;
          }

          if (
            !error ||
            error instanceof NotFoundException ||
            error instanceof ChecksumException ||
            error instanceof FormatException
          ) {
            return;
          }

          setCameraMode("manual");
          setStatus(copy.sellerHome.scannerCannotStart);
          reader.stopContinuousDecode();
          reader.reset();
          readerRef.current = null;
        }
      );

      if (cancelled) {
        reader.stopContinuousDecode();
        reader.reset();
        readerRef.current = null;
        detachVideoStream();
      }
    }

    async function startScanner() {
      const reader = new BrowserMultiFormatReader(SCANNER_HINTS);

      try {
        await startReaderWithConstraints(SCANNER_CONSTRAINTS, reader);
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (
          error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "SecurityError")
        ) {
          setCameraMode("manual");
          setStatus(copy.sellerHome.scannerPermissionDenied);
          return;
        }

        if (
          error instanceof DOMException &&
          (error.name === "OverconstrainedError" || error.name === "NotReadableError")
        ) {
          try {
            await startReaderWithConstraints(FALLBACK_SCANNER_CONSTRAINTS, reader);
            return;
          } catch (fallbackError) {
            if (
              fallbackError instanceof DOMException &&
              (fallbackError.name === "NotAllowedError" ||
                fallbackError.name === "SecurityError")
            ) {
              setCameraMode("manual");
              setStatus(copy.sellerHome.scannerPermissionDenied);
              return;
            }

            if (
              fallbackError instanceof DOMException &&
              fallbackError.name === "NotFoundError"
            ) {
              setCameraMode("manual");
              setStatus(copy.sellerHome.scannerNoCameraFound);
              return;
            }

            setCameraMode("manual");
            setStatus(copy.sellerHome.scannerCannotStart);
            return;
          }
        }

        if (error instanceof DOMException && error.name === "NotFoundError") {
          setCameraMode("manual");
          setStatus(copy.sellerHome.scannerNoCameraFound);
          return;
        }

        setCameraMode("manual");
        setStatus(copy.sellerHome.scannerUnsupported);
      }
    }

    startScanner();

    return () => {
      cancelled = true;
      cleanupScanner();
    };
  }, [
    cleanupScanner,
    copy.sellerHome.scannerCannotStart,
    copy.sellerHome.scannerNoCameraFound,
    copy.sellerHome.scannerPermissionDenied,
    copy.sellerHome.scannerPosition,
    copy.sellerHome.scannerRequiresSecureOrigin,
    copy.sellerHome.scannerUnsupported,
    detachVideoStream,
    onDetected,
    open,
  ]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="barcode-capture-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="barcode-capture-sheet surface-panel">
        <div className="barcode-capture-sheet__header">
          <div>
            <p className="eyebrow">{eyebrow || copy.sellerHome.barcode}</p>
            <h2>{title}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            {copy.common.close}
          </button>
        </div>

        {cameraMode === "camera" ? (
          <div className="barcode-capture-frame">
            <video ref={videoRef} playsInline muted autoPlay />
          </div>
        ) : null}

        <p className="muted-text">{status}</p>

        <div className="barcode-capture-manual">
          <input
            type="text"
            placeholder={copy.sellerHome.manualBarcodePlaceholder}
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
          />
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              if (manualValue.trim()) {
                onDetected(manualValue.trim());
              }
            }}
          >
            {copy.sellerHome.findProduct}
          </button>
        </div>
      </section>
    </div>
  );
}
