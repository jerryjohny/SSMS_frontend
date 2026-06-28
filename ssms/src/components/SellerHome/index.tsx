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
import { formatCurrency } from "../../utils/sales";
import { Product, SaleLine } from "../../utils/types";
import VoiceNoteControl from "../VoiceNoteControl";
import "./styles.css";

type EditableLineField =
  | "quantity_units"
  | "amount_paid"
  | "pickup_status"
  | "payment_status"
  | "note";

interface SellerHomeProps {
  allProducts: Product[];
  visibleProducts: Product[];
  query: string;
  onQueryChange: (value: string) => void;
  onCloseScanner: () => void;
  onCloseProductPicker: () => void;
  onCloseProductDetails: () => void;
  onBarcodeDetected: (barcode: string) => void;
  onConfirmProductDetails: () => void;
  onConfirmSelectedProducts: (products: Product[]) => void;
  onProductDetailChange: (field: EditableLineField, value: string | number) => void;
  draftLine: SaleLine | null;
  queuedDraftLinesCount: number;
  productPickerMode: "search" | "list";
  productPickerOpen: boolean;
  scannerOpen: boolean;
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

function appendTranscriptToNote(note: string, transcript: string): string {
  const existingNote = note.trim();
  const nextTranscript = transcript.trim();

  if (!existingNote) {
    return nextTranscript;
  }

  if (!nextTranscript) {
    return existingNote;
  }

  return `${existingNote} ${nextTranscript}`;
}

function localizePackagingDetails(
  packagingDetails: string | undefined,
  copy: ReturnType<typeof useI18n>["copy"]
): string {
  const normalizedValue = packagingDetails?.trim().toLowerCase();

  if (!normalizedValue) {
    return copy.sellerHome.standardStockItem;
  }

  if (normalizedValue === "unit") {
    return copy.common.singleUnit;
  }

  if (normalizedValue === "units") {
    return copy.common.units;
  }

  return packagingDetails || copy.sellerHome.standardStockItem;
}

function BarcodeScannerSheet({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
}) {
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
            onDetected(result.getText());
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
    copy.sellerHome.scannerCannotStart,
    copy.sellerHome.scannerNoCameraFound,
    copy.sellerHome.scannerPermissionDenied,
    copy.sellerHome.scannerPosition,
    copy.sellerHome.scannerRequiresSecureOrigin,
    copy.sellerHome.scannerUnsupported,
    cleanupScanner,
    detachVideoStream,
    onDetected,
    open,
  ]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="sheet surface-panel">
        <div className="sheet__header">
          <div>
            <p className="eyebrow">{copy.sellerHome.barcode}</p>
            <h2>{copy.sellerHome.cameraSellMode}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            {copy.common.close}
          </button>
        </div>

        {cameraMode === "camera" ? (
          <div className="scanner-frame">
            <video ref={videoRef} playsInline muted autoPlay />
          </div>
        ) : null}
        <p className="muted-text">{status}</p>

        <div className="manual-barcode">
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

function ProductPickerSheet({
  mode,
  open,
  allProducts,
  visibleProducts,
  query,
  onClose,
  onQueryChange,
  onConfirmSelection,
}: {
  mode: "search" | "list";
  open: boolean;
  allProducts: Product[];
  visibleProducts: Product[];
  query: string;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onConfirmSelection: (products: Product[]) => void;
}) {
  const { copy, language } = useI18n();
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);

  useEffect(() => {
    if (!open) {
      setSelectedProductIds([]);
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
    setSelectedProductIds((currentIds) =>
      currentIds.filter((productId) =>
        visibleProducts.some(
          (product) => product.id === productId && product.total_stock_units > 0
        )
      )
    );
  }, [visibleProducts]);

  function toggleProductSelection(productId: number) {
    setSelectedProductIds((currentIds) =>
      currentIds.includes(productId)
        ? currentIds.filter((currentId) => currentId !== productId)
        : [...currentIds, productId]
    );
  }

  function handleConfirmSelection() {
    const selectedProducts = selectedProductIds
      .map((productId) => allProducts.find((product) => product.id === productId))
      .filter((product): product is Product => Boolean(product));

    if (!selectedProducts.length) {
      return;
    }

    onConfirmSelection(selectedProducts);
    setSelectedProductIds([]);
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="sheet surface-panel picker-sheet">
        <div className="sheet__header">
          <div>
            <p className="eyebrow">{copy.profile.sell}</p>
            <h2>{mode === "search" ? copy.profile.sellBySearch : copy.profile.sellByList}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            {copy.common.close}
          </button>
        </div>

        <div className="search-bar picker-sheet__search">
          <input
            aria-label={copy.sellerHome.searchLabel}
            type="search"
            placeholder={copy.sellerHome.searchPlaceholder}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>

        <div className="picker-sheet__body">
          {visibleProducts.length ? (
            <div className="product-grid">
              {visibleProducts.map((product) => {
                const stockTone =
                  product.total_stock_units > 20
                    ? "positive"
                    : product.total_stock_units > 0
                    ? "warning"
                    : "danger";
                const isOutOfStock = product.total_stock_units <= 0;
                const isSelected = selectedProductIds.includes(product.id);

                return (
                  <button
                    key={product.id}
                    type="button"
                    className={`product-card${isSelected ? " selected" : ""}${
                      isOutOfStock ? " disabled" : ""
                    }`}
                    aria-pressed={isSelected}
                    disabled={isOutOfStock}
                    onClick={() => {
                      if (isOutOfStock) {
                        return;
                      }

                      toggleProductSelection(product.id);
                    }}
                  >
                    <div className="product-card__media">
                      {product.image ? (
                        <img src={product.image} alt={product.name} />
                      ) : (
                        <span>{product.name.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="product-card__body">
                      <div>
                        <h3>{product.name}</h3>
                        <p>{localizePackagingDetails(product.packaging_details, copy)}</p>
                      </div>
                      <div className="product-card__meta">
                        <strong>{formatCurrency(product.unit_price, language)}</strong>
                        <span className={`status-pill tone-${stockTone}`}>
                          {isOutOfStock
                            ? copy.common.outOfStock
                            : copy.common.inStock(product.total_stock_units)}
                        </span>
                      </div>
                      <div className="product-card__selection">
                        <span className={`status-pill ${isSelected ? "tone-positive" : "tone-neutral"}`}>
                          {isSelected ? copy.profile.selected : copy.profile.tapToSelect}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="empty-state">{copy.sellerHome.noProductsMatch}</p>
          )}
        </div>

        <div className="picker-sheet__footer">
          <span className="muted-text">{copy.profile.selectedItemsCount(selectedProductIds.length)}</span>
          <button
            type="button"
            className="primary-button"
            disabled={!selectedProductIds.length}
            onClick={handleConfirmSelection}
          >
            {copy.profile.reviewSelectedItems}
          </button>
        </div>
      </section>
    </div>
  );
}

function ProductDetailsSheet({
  line,
  open,
  onClose,
  onConfirm,
  onLineChange,
  queuedLinesCount,
}: {
  line: SaleLine | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onLineChange: (field: EditableLineField, value: string | number) => void;
  queuedLinesCount: number;
}) {
  const { copy, language } = useI18n();

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

  if (!open || !line) {
    return null;
  }

  const lineTotal = Number(line.quantity_units) * Number(line.unit_price);

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="sheet surface-panel detail-sheet">
        <div className="sheet__header">
          <div>
            <p className="eyebrow">{copy.profile.itemDetails}</p>
            <h2>{line.product_name}</h2>
            <p className="muted-text">
              {formatCurrency(line.unit_price, language)} {copy.profile.each}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            {copy.common.close}
          </button>
        </div>

        <div className="field-grid">
          <label className="field-stack">
            <span>{copy.common.units}</span>
            <input
              type="number"
              min="1"
              value={line.quantity_units}
              onChange={(event) =>
                onLineChange("quantity_units", Number(event.target.value) || 1)
              }
            />
          </label>
          <label className="field-stack">
            <span>{copy.profile.amountPaid}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={line.amount_paid}
              onChange={(event) => onLineChange("amount_paid", event.target.value)}
            />
          </label>
          <label className="field-stack">
            <span>{copy.profile.pickup}</span>
            <select
              value={line.pickup_status}
              onChange={(event) => onLineChange("pickup_status", event.target.value)}
            >
              <option value="now">{copy.profile.now}</option>
              <option value="later">{copy.profile.later}</option>
            </select>
          </label>
          <label className="field-stack">
            <span>{copy.profile.payment}</span>
            <select
              value={line.payment_status}
              onChange={(event) => onLineChange("payment_status", event.target.value)}
            >
              <option value="now">{copy.profile.now}</option>
              <option value="partial">{copy.profile.partial}</option>
              <option value="later">{copy.profile.later}</option>
            </select>
          </label>
        </div>

        <label className="field-stack">
          <span>{copy.profile.contextNote}</span>
          <textarea
            rows={3}
            value={line.note}
            onChange={(event) => onLineChange("note", event.target.value)}
            placeholder={copy.profile.contextPlaceholder}
          />
        </label>
        <VoiceNoteControl
          onTranscript={(transcript) =>
            onLineChange("note", appendTranscriptToNote(line.note, transcript))
          }
        />

        <div className="detail-sheet__footer">
          <div className="detail-sheet__summary">
            <span>{copy.common.total}</span>
            <strong>{formatCurrency(lineTotal, language)}</strong>
          </div>
          <button type="button" className="primary-button" onClick={onConfirm}>
            {queuedLinesCount > 0 ? copy.profile.saveAndNext : copy.common.save}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function SellerHome({
  allProducts,
  visibleProducts,
  query,
  onQueryChange,
  onCloseScanner,
  onCloseProductPicker,
  onCloseProductDetails,
  onBarcodeDetected,
  onConfirmProductDetails,
  onConfirmSelectedProducts,
  onProductDetailChange,
  draftLine,
  queuedDraftLinesCount,
  productPickerMode,
  productPickerOpen,
  scannerOpen,
}: SellerHomeProps) {
  return (
    <>
      <ProductPickerSheet
        mode={productPickerMode}
        open={productPickerOpen}
        allProducts={allProducts}
        visibleProducts={visibleProducts}
        query={query}
        onClose={onCloseProductPicker}
        onQueryChange={onQueryChange}
        onConfirmSelection={onConfirmSelectedProducts}
      />

      <ProductDetailsSheet
        line={draftLine}
        open={Boolean(draftLine)}
        onClose={onCloseProductDetails}
        onConfirm={onConfirmProductDetails}
        onLineChange={onProductDetailChange}
        queuedLinesCount={queuedDraftLinesCount}
      />

      <BarcodeScannerSheet
        open={scannerOpen}
        onClose={onCloseScanner}
        onDetected={onBarcodeDetected}
      />
    </>
  );
}
