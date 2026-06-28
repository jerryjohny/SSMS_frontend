import { useDeferredValue, useEffect, useState } from "react";

import { useAuth } from "../authContext";
import Profile from "../components/Profile";
import SellerHome from "../components/SellerHome";
import { useI18n } from "../i18nContext";
import {
  clearStoredSaleDraft,
  fetchProducts,
  fetchQueuedSales,
  readStoredSaleDraft,
  subscribeToOutbox,
  submitSale,
  writeStoredSaleDraft,
} from "../utils/api";
import { requiresCustomer, summarizeSale } from "../utils/sales";
import { CustomerDraft, Product, SaleDraftState, SaleLine, SalePayload } from "../utils/types";

type EditableLineField =
  | "quantity_units"
  | "amount_paid"
  | "pickup_status"
  | "payment_status"
  | "note";

function emptyCustomer(): CustomerDraft {
  return {
    id: undefined,
    name: "",
    reference: "",
    phone: "",
  };
}

function createSaleLine(product: Product, existingLine?: SaleLine): SaleLine {
  if (existingLine) {
    return { ...existingLine };
  }

  return {
    local_id: crypto.randomUUID(),
    product_id: product.id,
    product_name: product.name,
    quantity_units: 1,
    unit_price: product.unit_price,
    amount_paid: product.unit_price,
    pickup_status: "now",
    payment_status: "now",
    note: "",
  };
}

function normalizeLineAfterChange(
  line: SaleLine,
  field: EditableLineField,
  value: string | number
): SaleLine {
  const nextLine = { ...line, [field]: value };
  const quantityUnits = Number(nextLine.quantity_units) || 1;
  const unitPrice = Number(nextLine.unit_price) || 0;
  const lineTotal = quantityUnits * unitPrice;

  if (field === "payment_status") {
    if (value === "later") {
      nextLine.amount_paid = "0";
    } else if (value === "now") {
      nextLine.amount_paid = String(lineTotal);
    }
  }

  if (field === "quantity_units") {
    if (nextLine.payment_status === "later") {
      nextLine.amount_paid = "0";
    } else if (nextLine.payment_status === "now") {
      nextLine.amount_paid = String(lineTotal);
    }
  }

  return nextLine;
}

function formatMoneyValue(value: number): string {
  return value.toFixed(2);
}

function normalizeAmountPaidForSubmit(line: SaleLine): string {
  const quantityUnits = Number(line.quantity_units) || 1;
  const unitPrice = Number(line.unit_price) || 0;
  const lineTotal = quantityUnits * unitPrice;
  const parsedAmountPaid = Number(line.amount_paid);
  const hasValidAmountPaid =
    String(line.amount_paid).trim() !== "" && Number.isFinite(parsedAmountPaid) && parsedAmountPaid >= 0;

  if (line.payment_status === "later") {
    return formatMoneyValue(0);
  }

  if (line.payment_status === "now") {
    return formatMoneyValue(hasValidAmountPaid ? parsedAmountPaid : lineTotal);
  }

  return formatMoneyValue(hasValidAmountPaid ? parsedAmountPaid : 0);
}

export default function HomePage() {
  const { copy } = useI18n();
  const { currentStore, currentStoreId, user } = useAuth();
  const userId = user?.id ?? null;
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [saleLines, setSaleLines] = useState<SaleLine[]>([]);
  const [customer, setCustomer] = useState<CustomerDraft>(emptyCustomer);
  const [queuedSalesCount, setQueuedSalesCount] = useState<number>(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerMode, setProductPickerMode] = useState<"search" | "list">("search");
  const [draftLine, setDraftLine] = useState<SaleLine | null>(null);
  const [draftLineQueue, setDraftLineQueue] = useState<SaleLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [hydratedDraftScope, setHydratedDraftScope] = useState("");
  const deferredQuery = useDeferredValue(query);
  const draftScope = userId ? `${userId}:${currentStoreId ?? "none"}` : "";

  useEffect(() => {
    fetchProducts(currentStoreId || undefined).then(setProducts);
    setQueuedSalesCount(fetchQueuedSales().length);
  }, [currentStoreId]);

  useEffect(() => {
    function refreshQueuedSalesCount() {
      setQueuedSalesCount(fetchQueuedSales().length);
    }

    return subscribeToOutbox(refreshQueuedSalesCount);
  }, []);

  useEffect(() => {
    setHydratedDraftScope("");
    setQuery("");
    setSaleLines([]);
    setCustomer(emptyCustomer());
    setDraftLine(null);
    setDraftLineQueue([]);
    setScannerOpen(false);
    setProductPickerOpen(false);
    setSubmitMessage("");

    if (!userId) {
      return;
    }

    const draft = readStoredSaleDraft(userId, currentStoreId);
    setQuery(draft.query);
    setSaleLines(draft.lines);
    setCustomer(draft.customer);
    setHydratedDraftScope(draftScope);
  }, [currentStoreId, draftScope, userId]);

  useEffect(() => {
    if (!userId || hydratedDraftScope !== draftScope) {
      return;
    }

    const draft: SaleDraftState = {
      query,
      customer,
      lines: saleLines,
    };

    writeStoredSaleDraft(userId, currentStoreId, draft);
  }, [currentStoreId, customer, draftScope, hydratedDraftScope, query, saleLines, userId]);

  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredProducts = !normalizedQuery
    ? products
    : products.filter((product) => {
        const haystack = `${product.name} ${product.barcode}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      });
  const saleSummary = summarizeSale(saleLines);

  function handleSellByScan() {
    setProductPickerOpen(false);
    setScannerOpen(true);
  }

  function handleSellBySearch() {
    setScannerOpen(false);
    setQuery("");
    setProductPickerMode("search");
    setProductPickerOpen(true);
  }

  function beginProductDetailFlow(selectedProducts: Product[]) {
    if (!selectedProducts.length) {
      return;
    }

    setProductPickerOpen(false);
    setScannerOpen(false);
    setSubmitMessage("");
    setDraftLine(null);
    setDraftLineQueue([]);
    setSaleLines((currentLines) => {
      let nextLines = [...currentLines];

      for (const product of selectedProducts) {
        const existingIndex = nextLines.findIndex((line) => line.product_id === product.id);

        if (existingIndex >= 0) {
          const existingLine = nextLines[existingIndex];
          const nextQuantityUnits = (Number(existingLine.quantity_units) || 1) + 1;
          nextLines[existingIndex] = normalizeLineAfterChange(
            existingLine,
            "quantity_units",
            nextQuantityUnits
          );
          continue;
        }

        nextLines = [createSaleLine(product), ...nextLines];
      }

      return nextLines;
    });
  }

  function confirmDraftLine() {
    if (!draftLine) {
      return;
    }

    setSaleLines((currentLines) => {
      const existingIndex = currentLines.findIndex((line) => line.local_id === draftLine.local_id);
      if (existingIndex >= 0) {
        return currentLines.map((line) => (line.local_id === draftLine.local_id ? draftLine : line));
      }

      return [draftLine, ...currentLines];
    });

    setDraftLineQueue((currentQueue) => {
      if (!currentQueue.length) {
        setDraftLine(null);
        return currentQueue;
      }

      const [nextDraftLine, ...remainingQueue] = currentQueue;
      setDraftLine(nextDraftLine);
      return remainingQueue;
    });
  }

  function updateDraftLine(field: EditableLineField, value: string | number) {
    setDraftLine((currentLine) =>
      currentLine ? normalizeLineAfterChange(currentLine, field, value) : currentLine
    );
  }

  function updateLine(
    localId: string,
    field: EditableLineField,
    value: string | number
  ) {
    setSaleLines((currentLines) =>
      currentLines.map((line) =>
        line.local_id === localId ? normalizeLineAfterChange(line, field, value) : line
      )
    );
  }

  function removeLine(localId: string) {
    setSaleLines((currentLines) => currentLines.filter((line) => line.local_id !== localId));
  }

  function handleDetectedBarcode(barcode: string) {
    const matchedProduct = products.find((product) => product.barcode === barcode);
    setProductPickerOpen(false);
    setScannerOpen(false);
    if (matchedProduct) {
      if (matchedProduct.total_stock_units <= 0) {
        setSubmitMessage(
          copy.homePage.notAvailableInCurrentShop(
            matchedProduct.name,
            currentStore?.name || copy.common.store
          )
        );
        return;
      }

      beginProductDetailFlow([matchedProduct]);
      return;
    }
    setSubmitMessage(copy.homePage.notFoundByBarcode(barcode));
  }

  async function handleSubmit() {
    if (!saleLines.length || !currentStoreId) {
      return;
    }

    if (
      requiresCustomer(saleLines) &&
      !customer.id &&
      (!customer.name.trim() || !customer.reference.trim())
    ) {
      setSubmitMessage(copy.homePage.customerRequired);
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage("");

    const payload: SalePayload = {
      store: currentStoreId,
      note: saleSummary.pending ? copy.homePage.pendingNote : "",
      items: saleLines.map((line) => ({
        product: line.product_id,
        quantity_units: Number(line.quantity_units),
        unit_price: line.unit_price,
        amount_paid: normalizeAmountPaidForSubmit(line),
        pickup_status: line.pickup_status,
        payment_status: line.payment_status,
        note: line.note,
      })),
    };

    if (customer.id) {
      payload.customer = {
        id: customer.id,
      };
    } else if (customer.name && customer.reference) {
      payload.customer = {
        name: customer.name,
        reference: customer.reference,
        phone: customer.phone,
      };
    }

    const result = await submitSale(payload);
    setIsSubmitting(false);

    if (result.status === "failed") {
      setSubmitMessage(result.error || copy.homePage.saleFailed);
      return;
    }

    setQueuedSalesCount(fetchQueuedSales().length);
    setSaleLines([]);
    setCustomer(emptyCustomer());
    setQuery("");
    setSubmitMessage(result.status === "submitted" ? copy.homePage.saleSaved : copy.homePage.saleQueued);

    if (userId) {
      clearStoredSaleDraft(userId, currentStoreId);
    }
  }

  return (
    <>
      <SellerHome
        allProducts={products}
        visibleProducts={filteredProducts}
        query={query}
        onQueryChange={setQuery}
        onCloseScanner={() => setScannerOpen(false)}
        onCloseProductPicker={() => setProductPickerOpen(false)}
        onCloseProductDetails={() => {
          setDraftLine(null);
          setDraftLineQueue([]);
        }}
        onBarcodeDetected={handleDetectedBarcode}
        onConfirmProductDetails={confirmDraftLine}
        onConfirmSelectedProducts={beginProductDetailFlow}
        onProductDetailChange={updateDraftLine}
        draftLine={draftLine}
        queuedDraftLinesCount={draftLineQueue.length}
        productPickerMode={productPickerMode}
        productPickerOpen={productPickerOpen}
        scannerOpen={scannerOpen}
      />

      <div className="page-stack">
        <Profile
          lines={saleLines}
          customer={customer}
          feedbackMessage={submitMessage}
          queuedSalesCount={queuedSalesCount}
          isSubmitting={isSubmitting}
          onCustomerChange={(field, value) =>
            setCustomer((currentValue) => ({ ...currentValue, [field]: value }))
          }
          onSellByScan={handleSellByScan}
          onSellBySearch={handleSellBySearch}
          onLineChange={updateLine}
          onRemoveLine={removeLine}
          onSubmit={handleSubmit}
        />
      </div>
    </>
  );
}
