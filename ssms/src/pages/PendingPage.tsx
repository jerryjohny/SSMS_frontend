import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../authContext";
import Queue from "../components/Queue";
import { useI18n } from "../i18nContext";
import { fetchPendingItems, regularizePendingItem, reorderPendingItems } from "../utils/api";
import { formatCurrency } from "../utils/sales";
import { PendingItem } from "../utils/types";

type PendingTab = "general" | "all" | "pickup";

function PendingRegularizeSheet({
  item,
  isSubmitting,
  errorMessage,
  onClose,
  onSubmit,
}: {
  item: PendingItem | null;
  isSubmitting: boolean;
  errorMessage: string;
  onClose: () => void;
  onSubmit: (payload: { mark_collected: boolean; regularize_amount?: string }) => void;
}) {
  const { copy, language } = useI18n();
  const [markCollected, setMarkCollected] = useState(false);
  const [regularizeAmount, setRegularizeAmount] = useState("");

  useEffect(() => {
    if (!item) {
      return;
    }

    const outstandingAmount =
      Number(item.debt_amount) > 0
        ? Number(item.debt_amount)
        : Number(item.credit_amount) > 0
          ? Number(item.credit_amount)
          : 0;

    setMarkCollected(item.pickup_status === "later" || !item.is_collected);
    setRegularizeAmount(outstandingAmount > 0 ? String(outstandingAmount) : "");
  }, [item]);

  useEffect(() => {
    if (!item) {
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
  }, [item, onClose]);

  if (!item) {
    return null;
  }

  const canMarkCollected = item.pickup_status === "later" || !item.is_collected;
  const outstandingAmount =
    Number(item.debt_amount) > 0
      ? Number(item.debt_amount)
      : Number(item.credit_amount) > 0
        ? Number(item.credit_amount)
        : 0;
  const canRegularizeAmount = outstandingAmount > 0;
  const normalizedRegularizeAmount = Number(regularizeAmount) || 0;
  const amountExceedsOutstanding =
    canRegularizeAmount && normalizedRegularizeAmount > outstandingAmount;
  const canSubmit =
    !amountExceedsOutstanding &&
    ((canMarkCollected && markCollected) || (canRegularizeAmount && normalizedRegularizeAmount > 0));

  return (
    <div
      className="pending-sheet-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="pending-sheet surface-panel">
        <div className="pending-sheet__header">
          <div>
            <p className="eyebrow">{copy.pending.pendingList}</p>
            <h2>{copy.pending.regularizeTitle}</h2>
            <p className="section-copy">{item.product_name}</p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            {copy.common.close}
          </button>
        </div>

        <div className="pending-sheet__meta">
          <span>{item.customer_name || copy.pending.walkInCustomer}</span>
          <span>{item.store_name}</span>
          <span>{item.order_number}</span>
        </div>

        <div className="pending-sheet__status">
          <span>{formatCurrency(item.line_total, language)}</span>
          {Number(item.debt_amount) > 0 ? (
            <span>{copy.common.debt} {formatCurrency(item.debt_amount, language)}</span>
          ) : null}
          {Number(item.credit_amount) > 0 ? (
            <span>{copy.common.credit} {formatCurrency(item.credit_amount, language)}</span>
          ) : null}
          {item.pickup_status === "later" ? <span>{copy.pending.pickupLater}</span> : null}
        </div>

        <div className="pending-regularize-options">
          {canMarkCollected ? (
            <label className="pending-regularize-option">
              <input
                type="checkbox"
                checked={markCollected}
                onChange={(event) => setMarkCollected(event.target.checked)}
              />
              <div>
                <strong>{copy.pending.markCollected}</strong>
                <p>{copy.pending.markCollectedHelp}</p>
              </div>
            </label>
          ) : null}

          {canRegularizeAmount ? (
            <div className="pending-regularize-option pending-regularize-option--amount">
              <div>
                <strong>{copy.pending.regularizeAmount}</strong>
                <p>
                  {Number(item.debt_amount) > 0
                    ? copy.pending.regularizeDebtHelp(formatCurrency(item.debt_amount, language))
                    : copy.pending.regularizeCreditHelp(formatCurrency(item.credit_amount, language))}
                </p>
              </div>
              <label className="field-stack pending-regularize-option__field">
                <span>{copy.pending.amountToApply}</span>
                <input
                  type="number"
                  min="0"
                  max={outstandingAmount}
                  step="0.01"
                  value={regularizeAmount}
                  onChange={(event) => setRegularizeAmount(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>

        {amountExceedsOutstanding ? (
          <p className="inline-feedback">{copy.pending.regularizeAmountTooHigh}</p>
        ) : null}
        {errorMessage ? <p className="inline-feedback">{errorMessage}</p> : null}

        <div className="pending-sheet__footer">
          <span className="section-copy">{item.note || copy.pending.noNote}</span>
          <button
            type="button"
            className="primary-button"
            disabled={!canSubmit || isSubmitting}
            onClick={() =>
              onSubmit({
                mark_collected: markCollected,
                regularize_amount:
                  canRegularizeAmount && normalizedRegularizeAmount > 0
                    ? String(normalizedRegularizeAmount)
                    : undefined,
              })
            }
          >
            {isSubmitting ? copy.pending.regularizing : copy.pending.regularize}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function PendingPage() {
  const { copy } = useI18n();
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [activeTab, setActiveTab] = useState<PendingTab>("general");
  const [selectedItem, setSelectedItem] = useState<PendingItem | null>(null);
  const [isRegularizing, setIsRegularizing] = useState(false);
  const [regularizeError, setRegularizeError] = useState("");
  const { role } = useAuth();

  const uncollectedItems = useMemo(
    () => pendingItems.filter((item) => item.pickup_status === "later"),
    [pendingItems]
  );
  const tabItems = useMemo<Array<{ key: PendingTab; label: string }>>(
    () => [
      { key: "general", label: copy.pending.generalTab },
      { key: "all", label: copy.pending.pendingList },
      { key: "pickup", label: copy.pending.uncollected },
    ],
    [copy.pending.generalTab, copy.pending.pendingList, copy.pending.uncollected]
  );
  const visibleItems = useMemo(() => {
    switch (activeTab) {
      case "pickup":
        return uncollectedItems;
      case "all":
      default:
        return pendingItems;
    }
  }, [activeTab, pendingItems, uncollectedItems]);

  useEffect(() => {
    loadPendingItems();
  }, []);

  function loadPendingItems() {
    fetchPendingItems().then((items) => {
      const normalized = [...items].sort((left, right) => left.pending_priority - right.pending_priority);
      setPendingItems(normalized);
    });
  }

  function handleReorder(nextItems: PendingItem[]) {
    setPendingItems(nextItems);
    reorderPendingItems(
      nextItems.map((item) => ({
        id: item.id,
        pending_priority: item.pending_priority,
      }))
    );
  }

  async function handleRegularize(payload: {
    mark_collected: boolean;
    regularize_amount?: string;
  }) {
    if (!selectedItem) {
      return;
    }

    setIsRegularizing(true);
    setRegularizeError("");

    try {
      const updatedItem = await regularizePendingItem(selectedItem.id, payload);
      setPendingItems((currentItems) => {
        if (updatedItem.pending_priority > 0) {
          return currentItems
            .map((item) => (item.id === updatedItem.id ? updatedItem : item))
            .sort((left, right) => left.pending_priority - right.pending_priority);
        }

        return currentItems.filter((item) => item.id !== updatedItem.id);
      });
      setSelectedItem(null);
    } catch (error) {
      setRegularizeError(
        error instanceof Error ? error.message : copy.pending.regularizeError
      );
    } finally {
      setIsRegularizing(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="section-tabs" role="tablist" aria-label={copy.pending.sectionNavigation}>
        {tabItems.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={activeTab === item.key}
            className={`section-tabs__button ${activeTab === item.key ? "active" : ""}`}
            onClick={() => setActiveTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {activeTab === "general" ? (
        <section className="surface-panel compact-hero">
          <div>
            <p className="eyebrow">{copy.pending.heroEyebrow}</p>
            <h2>{copy.pending.heroTitle}</h2>
            <p className="section-copy">
              {role === "seller" ? copy.pending.sellerHint : copy.pending.adminHint}
            </p>
          </div>
          <div className="metric-grid">
            <button
              type="button"
              className="metric-card metric-card--button tone-accent"
              onClick={() => setActiveTab("all")}
            >
              <span>{copy.pending.pendingItems}</span>
              <strong>{pendingItems.length}</strong>
            </button>
            <button
              type="button"
              className="metric-card metric-card--button tone-cool"
              onClick={() => setActiveTab("pickup")}
            >
              <span>{copy.pending.uncollected}</span>
              <strong>{uncollectedItems.length}</strong>
            </button>
          </div>
        </section>
      ) : null}

      {activeTab !== "general" ? (
        <section className="surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                {activeTab === "all"
                  ? copy.pending.priorityOrder
                  : copy.pending.uncollected}
              </p>
              <h2>
                {activeTab === "all"
                  ? copy.pending.pendingList
                  : copy.pending.uncollected}
              </h2>
            </div>
          </div>
          <Queue
            items={visibleItems}
            canReorder={role !== "seller" && activeTab === "all"}
            onReorder={handleReorder}
            onSelectItem={(item) => {
              setRegularizeError("");
              setSelectedItem(item);
            }}
          />
        </section>
      ) : null}

      <PendingRegularizeSheet
        item={selectedItem}
        isSubmitting={isRegularizing}
        errorMessage={regularizeError}
        onClose={() => {
          setRegularizeError("");
          setSelectedItem(null);
        }}
        onSubmit={handleRegularize}
      />
    </div>
  );
}
