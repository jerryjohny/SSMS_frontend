import { useEffect, useState } from "react";

import { useAuth } from "../../authContext";
import { useI18n } from "../../i18nContext";
import {
  fetchAccountingSnapshot,
  fetchCustomers,
  requestOpenOfflineQueue,
} from "../../utils/api";
import {
  formatCurrency,
  requiresCustomer,
  summarizeLine,
  summarizeSale,
} from "../../utils/sales";
import {
  AccountingSnapshot,
  CustomerAccount,
  CustomerDraft,
  SaleLine,
  Store,
} from "../../utils/types";
import VoiceNoteControl from "../VoiceNoteControl";
import "./styles.css";

type EditableLineField =
  | "quantity_units"
  | "amount_paid"
  | "pickup_status"
  | "payment_status"
  | "note";

interface ProfileProps {
  lines: SaleLine[];
  customer: CustomerDraft;
  feedbackMessage: string;
  queuedSalesCount: number;
  isSubmitting: boolean;
  onCustomerChange: (field: keyof CustomerDraft, value: string | number | undefined) => void;
  onSellByScan: () => void;
  onSellBySearch: () => void;
  onLineChange: (localId: string, field: EditableLineField, value: string | number) => void;
  onRemoveLine: (localId: string) => void;
  onSubmit: () => void;
}

function paymentSummaryText(line: SaleLine, copy: ReturnType<typeof useI18n>["copy"]) {
  switch (line.payment_status) {
    case "partial":
      return copy.profile.paymentPartialSummary;
    case "later":
      return copy.profile.paymentLaterSummary;
    case "now":
    default:
      return copy.profile.paymentNowSummary;
  }
}

function pickupSummaryText(line: SaleLine, copy: ReturnType<typeof useI18n>["copy"]) {
  return line.pickup_status === "later"
    ? copy.profile.pickupLaterSummary
    : copy.profile.pickupNowSummary;
}

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

function todayDateInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
}

function formatDateTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function HeaderActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="sell-action-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PaymentSummary({ line }: { line: SaleLine }) {
  const { copy, language } = useI18n();
  const summary = summarizeLine(line);

  if (summary.debt > 0) {
    return (
      <span className="status-pill tone-warning">
        {copy.profile.debtLabel(formatCurrency(summary.debt, language))}
      </span>
    );
  }
  if (summary.credit > 0) {
    return (
      <span className="status-pill tone-positive">
        {copy.profile.creditLabel(formatCurrency(summary.credit, language))}
      </span>
    );
  }
  if (summary.pending) {
    return <span className="status-pill tone-warning">{copy.profile.pendingFollowUp}</span>;
  }
  return <span className="status-pill tone-neutral">{copy.profile.settled}</span>;
}

function LineEditorSheet({
  line,
  open,
  onClose,
  onLineChange,
  onRemoveLine,
}: {
  line: SaleLine | null;
  open: boolean;
  onClose: () => void;
  onLineChange: (localId: string, field: EditableLineField, value: string | number) => void;
  onRemoveLine: (localId: string) => void;
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

  const lineSummary = summarizeLine(line);

  return (
    <div
      className="line-editor-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="line-editor-sheet surface-panel">
        <div className="line-editor-sheet__header">
          <div>
            <p className="eyebrow">{copy.profile.editItem}</p>
            <h2>{line.product_name}</h2>
            <p className="profile-copy">
              {line.quantity_units} x {line.product_name} / {paymentSummaryText(line, copy)} /{" "}
              {pickupSummaryText(line, copy)}
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
                onLineChange(line.local_id, "quantity_units", Number(event.target.value) || 1)
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
              onChange={(event) => onLineChange(line.local_id, "amount_paid", event.target.value)}
            />
          </label>
          <label className="field-stack">
            <span>{copy.profile.pickup}</span>
            <select
              value={line.pickup_status}
              onChange={(event) => onLineChange(line.local_id, "pickup_status", event.target.value)}
            >
              <option value="now">{copy.profile.now}</option>
              <option value="later">{copy.profile.later}</option>
            </select>
          </label>
          <label className="field-stack">
            <span>{copy.profile.payment}</span>
            <select
              value={line.payment_status}
              onChange={(event) => onLineChange(line.local_id, "payment_status", event.target.value)}
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
            onChange={(event) => onLineChange(line.local_id, "note", event.target.value)}
            placeholder={copy.profile.contextPlaceholder}
          />
        </label>
        <VoiceNoteControl
          onTranscript={(transcript) =>
            onLineChange(line.local_id, "note", appendTranscriptToNote(line.note, transcript))
          }
        />

        <div className="line-editor-sheet__footer">
          <div className="line-editor-sheet__totals">
            <strong>{formatCurrency(lineSummary.lineTotal, language)}</strong>
            <PaymentSummary line={line} />
          </div>
          <div className="line-editor-sheet__actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                onRemoveLine(line.local_id);
                onClose();
              }}
            >
              {copy.profile.remove}
            </button>
            <button type="button" className="primary-button line-editor-sheet__ok" onClick={onClose}>
              {copy.common.ok}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function CustomerDetailsSheet({
  customer,
  open,
  isSubmitting,
  onClose,
  onCustomerChange,
  onSubmit,
}: {
  customer: CustomerDraft;
  open: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onCustomerChange: (field: keyof CustomerDraft, value: string | number | undefined) => void;
  onSubmit: () => void;
}) {
  const { copy } = useI18n();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOptions, setCustomerOptions] = useState<CustomerAccount[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState("");
  const customerReady =
    mode === "existing" ? Boolean(customer.id) : Boolean(customer.name.trim() && customer.reference.trim());

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
      return;
    }

    const hasDraftValues = customer.name.trim() || customer.reference.trim() || customer.phone.trim();
    setMode(customer.id ? "existing" : hasDraftValues ? "new" : "existing");
  }, [customer.id, customer.name, customer.phone, customer.reference, open]);

  useEffect(() => {
    if (!open || mode !== "existing") {
      return;
    }

    let cancelled = false;
    setIsLoadingCustomers(true);
    setCustomerSearchError("");

    fetchCustomers(customerQuery)
      .then((results) => {
        if (!cancelled) {
          setCustomerOptions(results);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCustomerOptions([]);
          setCustomerSearchError(
            error instanceof Error ? error.message : copy.profile.customerSearchError
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingCustomers(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [copy.profile.customerSearchError, customerQuery, mode, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="line-editor-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="line-editor-sheet customer-sheet surface-panel">
        <div className="line-editor-sheet__header">
          <div>
            <p className="eyebrow">{copy.profile.customer}</p>
            <h2>{copy.profile.requiredForPendingItems}</h2>
            <p className="profile-copy">{copy.homePage.customerRequired}</p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            {copy.common.close}
          </button>
        </div>

        <div className="customer-sheet__tabs" role="tablist" aria-label={copy.profile.customer}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "existing"}
            className={`customer-sheet__tab${mode === "existing" ? " active" : ""}`}
            onClick={() => setMode("existing")}
          >
            {copy.profile.useExistingCustomer}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "new"}
            className={`customer-sheet__tab${mode === "new" ? " active" : ""}`}
            onClick={() => {
              setMode("new");
              onCustomerChange("id", undefined);
            }}
          >
            {copy.profile.createNewCustomer}
          </button>
        </div>

        {mode === "existing" ? (
          <div className="customer-sheet__existing">
            <label className="field-stack">
              <span>{copy.profile.searchCustomer}</span>
              <input
                value={customerQuery}
                onChange={(event) => setCustomerQuery(event.target.value)}
                placeholder={copy.profile.searchCustomerPlaceholder}
              />
            </label>

            {isLoadingCustomers ? <p className="empty-state">{copy.profile.loadingCustomers}</p> : null}
            {customerSearchError ? <p className="inline-feedback">{customerSearchError}</p> : null}

            {!isLoadingCustomers && !customerSearchError ? (
              customerOptions.length ? (
                <label className="field-stack">
                  <span>{copy.profile.selectCustomer}</span>
                  <select
                    value={customer.id ? String(customer.id) : ""}
                    onChange={(event) => {
                      const selectedId = Number(event.target.value);
                      const selectedCustomer = customerOptions.find(
                        (option) => option.id === selectedId
                      );

                      if (!selectedCustomer) {
                        onCustomerChange("id", undefined);
                        return;
                      }

                      onCustomerChange("id", selectedCustomer.id);
                      onCustomerChange("name", selectedCustomer.name);
                      onCustomerChange("reference", selectedCustomer.reference);
                      onCustomerChange("phone", selectedCustomer.phone || "");
                    }}
                  >
                    <option value="">{copy.profile.selectCustomer}</option>
                    {customerOptions.map((option) => (
                      <option key={option.id} value={String(option.id)}>
                        {option.name} / {option.reference}
                        {option.phone ? ` / ${option.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="empty-state">{copy.profile.noCustomersFound}</p>
              )
            ) : null}
          </div>
        ) : (
          <div className="field-grid">
            <label className="field-stack">
              <span>{copy.common.name}</span>
              <input
                value={customer.name}
                onChange={(event) => {
                  onCustomerChange("id", undefined);
                  onCustomerChange("name", event.target.value);
                }}
                placeholder="Maria"
              />
            </label>
            <label className="field-stack">
              <span>{copy.common.reference}</span>
              <input
                value={customer.reference}
                onChange={(event) => {
                  onCustomerChange("id", undefined);
                  onCustomerChange("reference", event.target.value);
                }}
                placeholder={copy.profile.referencePlaceholder}
              />
            </label>
            <label className="field-stack">
              <span>{copy.common.phone}</span>
              <input
                value={customer.phone}
                onChange={(event) => {
                  onCustomerChange("id", undefined);
                  onCustomerChange("phone", event.target.value);
                }}
                placeholder="+258 ..."
              />
            </label>
          </div>
        )}

        <div className="line-editor-sheet__footer">
          <span className="customer-sheet__hint">{copy.profile.requiredForPendingItems}</span>
          <button
            type="button"
            className="primary-button"
            disabled={!customerReady || isSubmitting}
            onClick={onSubmit}
          >
            {isSubmitting ? copy.profile.savingSale : copy.profile.confirmSale}
          </button>
        </div>
      </section>
    </div>
  );
}

function AccountingSheet({
  accountingDate,
  errorMessage,
  isLoading,
  open,
  selectedStoreId,
  snapshot,
  storeOptions,
  canViewAllStores,
  onClose,
  onDateChange,
  onStoreChange,
}: {
  accountingDate: string;
  errorMessage: string;
  isLoading: boolean;
  open: boolean;
  selectedStoreId: string;
  snapshot: AccountingSnapshot | null;
  storeOptions: Store[];
  canViewAllStores: boolean;
  onClose: () => void;
  onDateChange: (value: string) => void;
  onStoreChange: (value: string) => void;
}) {
  const { copy, language, locale } = useI18n();
  const [activeTab, setActiveTab] = useState<"general" | "details">("general");
  const [selectedSellerId, setSelectedSellerId] = useState("all");
  const [selectedProductId, setSelectedProductId] = useState("all");

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
      return;
    }

    setActiveTab("general");
    setSelectedSellerId("all");
    setSelectedProductId("all");
  }, [open, snapshot?.date, snapshot?.store_id]);

  if (!open) {
    return null;
  }

  const sellerOptions = snapshot?.sellers ?? [];
  const productOptions = snapshot
    ? Array.from(
        snapshot.sales.reduce((options, sale) => {
          sale.items.forEach((item) => {
            if (!options.has(item.product)) {
              options.set(item.product, item.product_name);
            }
          });
          return options;
        }, new Map<number, string>())
      )
        .map(([productId, productName]) => ({ productId, productName }))
        .sort((left, right) => left.productName.localeCompare(right.productName))
    : [];
  const filteredSales = snapshot
    ? snapshot.sales
        .filter((sale) => {
          const matchesSeller =
            selectedSellerId === "all" || String(sale.seller) === selectedSellerId;
          const matchesItem =
            selectedProductId === "all" ||
            sale.items.some((item) => String(item.product) === selectedProductId);

          return matchesSeller && matchesItem;
        })
        .map((sale) => ({
          ...sale,
          visibleItems:
            selectedProductId === "all"
              ? sale.items
              : sale.items.filter((item) => String(item.product) === selectedProductId),
        }))
    : [];
  const filteredDetailsTotal = filteredSales.reduce(
    (saleTotal, sale) =>
      saleTotal +
      sale.visibleItems.reduce(
        (itemTotal, item) => itemTotal + Number(item.line_total || 0),
        0
      ),
    0
  );
  const accountingTotal =
    activeTab === "details"
      ? filteredDetailsTotal
      : Number(snapshot?.summary.gross_total || 0);

  return (
    <div
      className="line-editor-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="line-editor-sheet accounting-sheet surface-panel">
        <div className="line-editor-sheet__header">
          <div>
            <p className="eyebrow">{copy.profile.accounting}</p>
            <h2>{copy.profile.accountingTitle}</h2>
            <p className="profile-copy">{copy.profile.accountingDescription}</p>
          </div>
          <div className="accounting-sheet__header-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              {copy.common.close}
            </button>
          </div>
        </div>

        <div className="accounting-tabs" role="tablist" aria-label={copy.profile.accountingTitle}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "general"}
            className={`accounting-tabs__button${activeTab === "general" ? " active" : ""}`}
            onClick={() => setActiveTab("general")}
          >
            {copy.profile.generalTab}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "details"}
            className={`accounting-tabs__button${activeTab === "details" ? " active" : ""}`}
            onClick={() => setActiveTab("details")}
          >
            {copy.profile.detailsTab}
          </button>
        </div>

        <div className="accounting-sheet__controls accounting-sheet__controls--with-total">
          <label className="field-stack accounting-sheet__date">
            <span>{copy.profile.accountingDate}</span>
            <input
              type="date"
              value={accountingDate}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>

          <div className="accounting-sheet__filtered-total">
            <span>{copy.common.total}</span>
            <strong>{formatCurrency(accountingTotal, language)}</strong>
          </div>

          <label className="field-stack accounting-sheet__store-field">
            <span>{copy.common.store}</span>
            <select
              value={selectedStoreId}
              onChange={(event) => onStoreChange(event.target.value)}
            >
              {canViewAllStores ? (
                <option value="all">{copy.profile.allStores}</option>
              ) : null}
              {storeOptions.map((store) => (
                <option key={store.id} value={String(store.id)}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading ? <p className="empty-state">{copy.profile.loadingAccounting}</p> : null}
        {errorMessage ? <p className="inline-feedback">{errorMessage}</p> : null}

        {!isLoading && !errorMessage && snapshot ? (
          <>
            {activeTab === "general" ? (
              <div className="accounting-metrics">
                <article className="accounting-metric-card">
                  <span>{copy.profile.salesCount}</span>
                  <strong>{snapshot.summary.sale_count}</strong>
                </article>
                <article className="accounting-metric-card">
                  <span>{copy.common.paid}</span>
                  <strong>{formatCurrency(snapshot.summary.paid_total, language)}</strong>
                </article>
                <article className="accounting-metric-card">
                  <span>{copy.common.debt}</span>
                  <strong>{formatCurrency(snapshot.summary.debt_total, language)}</strong>
                </article>
                <article className="accounting-metric-card">
                  <span>{copy.common.credit}</span>
                  <strong>{formatCurrency(snapshot.summary.credit_total, language)}</strong>
                </article>
              </div>
            ) : (
              <div className="accounting-section">
                <div className="accounting-filters">
                  <label className="field-stack">
                    <span>{copy.profile.accountingSellerFilter}</span>
                    <select
                      value={selectedSellerId}
                      onChange={(event) => setSelectedSellerId(event.target.value)}
                    >
                      <option value="all">{copy.profile.allSellers}</option>
                      {sellerOptions.map((seller) => (
                        <option key={seller.seller_id} value={String(seller.seller_id)}>
                          {seller.seller_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-stack">
                    <span>{copy.profile.accountingItemFilter}</span>
                    <select
                      value={selectedProductId}
                      onChange={(event) => setSelectedProductId(event.target.value)}
                    >
                      <option value="all">{copy.profile.allItems}</option>
                      {productOptions.map((product) => (
                        <option key={product.productId} value={String(product.productId)}>
                          {product.productName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="panel-heading compact">
                  <div>
                    <p className="eyebrow">{copy.profile.salesCount}</p>
                    <h3>{copy.profile.saleDetails}</h3>
                  </div>
                </div>

                {snapshot.sales.length === 0 ? (
                  <p className="empty-state">{copy.profile.noAccountingSales}</p>
                ) : filteredSales.length === 0 ? (
                  <p className="empty-state">{copy.profile.noFilteredAccountingSales}</p>
                ) : (
                  <div className="accounting-sale-list">
                    {filteredSales.map((sale) => (
                      <article key={sale.id} className="accounting-sale-card">
                        <div className="accounting-sale-card__header">
                          <div>
                            <h4>{sale.order_number}</h4>
                            <p className="profile-copy">
                              {copy.profile.soldByName(sale.seller_name)} /{" "}
                              {formatDateTime(sale.created_at, locale)}
                            </p>
                          </div>
                          <strong>{formatCurrency(sale.gross_total, language)}</strong>
                        </div>

                        <div className="accounting-sale-card__status">
                          <span>
                            {copy.common.paid}: {formatCurrency(sale.paid_total, language)}
                          </span>
                          {Number(sale.debt_total) > 0 ? (
                            <span>
                              {copy.profile.debtLabel(
                                formatCurrency(sale.debt_total, language)
                              )}
                            </span>
                          ) : null}
                          {Number(sale.credit_total) > 0 ? (
                            <span>
                              {copy.profile.creditLabel(
                                formatCurrency(sale.credit_total, language)
                              )}
                            </span>
                          ) : null}
                        </div>

                        <div className="accounting-sale-card__items">
                          {sale.visibleItems.map((item) => (
                            <div key={item.id} className="accounting-sale-card__item">
                              <span>
                                {item.quantity_units} x {item.product_name}
                              </span>
                              <strong>{formatCurrency(item.line_total, language)}</strong>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

export default function Profile({
  lines,
  customer,
  feedbackMessage,
  queuedSalesCount,
  isSubmitting,
  onCustomerChange,
  onSellByScan,
  onSellBySearch,
  onLineChange,
  onRemoveLine,
  onSubmit,
}: ProfileProps) {
  const { copy, language } = useI18n();
  const summary = summarizeSale(lines);
  const customerRequired = requiresCustomer(lines);
  const { availableStores, currentStoreId, role, userName } = useAuth();
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [accountingDate, setAccountingDate] = useState(todayDateInputValue);
  const [accountingError, setAccountingError] = useState("");
  const [accountingOpen, setAccountingOpen] = useState(false);
  const [accountingStoreId, setAccountingStoreId] = useState<string>("");
  const [accountingSnapshot, setAccountingSnapshot] = useState<AccountingSnapshot | null>(null);
  const [isLoadingAccounting, setIsLoadingAccounting] = useState(false);
  const [customerSheetOpen, setCustomerSheetOpen] = useState(false);
  const activityLabel = lines.length
    ? copy.profile.itemCount(lines.length)
    : copy.profile.readyForNextCustomer;
  const activeLine = lines.find((line) => line.local_id === activeLineId) || null;
  const canViewAccounting = role === "admin" || role === "sysadmin";

  useEffect(() => {
    if (activeLineId && !activeLine) {
      setActiveLineId(null);
    }
  }, [activeLine, activeLineId]);

  useEffect(() => {
    if (!customerRequired || !lines.length) {
      setCustomerSheetOpen(false);
    }
  }, [customerRequired, lines.length]);

  useEffect(() => {
    if (accountingOpen) {
      return;
    }

    if (currentStoreId) {
      setAccountingStoreId(String(currentStoreId));
      return;
    }

    if (role === "sysadmin") {
      setAccountingStoreId("all");
    }
  }, [accountingOpen, currentStoreId, role]);

  useEffect(() => {
    if (!accountingOpen || !canViewAccounting) {
      return;
    }

    let cancelled = false;
    setIsLoadingAccounting(true);
    setAccountingError("");

    const selectedStoreId =
      accountingStoreId && accountingStoreId !== "all"
        ? Number(accountingStoreId)
        : undefined;

    fetchAccountingSnapshot(accountingDate, selectedStoreId)
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        setAccountingSnapshot(snapshot);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setAccountingSnapshot(null);
        setAccountingError(
          error instanceof Error ? error.message : copy.profile.accountingError
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingAccounting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    accountingDate,
    accountingOpen,
    accountingStoreId,
    canViewAccounting,
    copy.profile.accountingError,
  ]);

  function handleSubmitClick() {
    if (customerRequired) {
      setCustomerSheetOpen(true);
      return;
    }

    onSubmit();
  }

  return (
    <section className="profile-panel surface-panel">
      {canViewAccounting ? (
        <button
          type="button"
          className="sell-accounting-button"
          aria-label={copy.profile.openAccounting}
          title={copy.profile.openAccounting}
          onClick={() => setAccountingOpen(true)}
        >
          <span className="sell-accounting-button__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
      ) : null}
      <div className="sell-header">
        <div className="sell-header__main">
          <div className="sell-toolbar">
            <h2>{copy.profile.sell}</h2>
            <div className="sell-toolbar__actions" role="group" aria-label={copy.profile.sell}>
              <HeaderActionButton label={copy.profile.sellByScan} onClick={onSellByScan}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 7V5.5C4 4.7 4.7 4 5.5 4H8M16 4h2.5c.8 0 1.5.7 1.5 1.5V7M20 17v1.5c0 .8-.7 1.5-1.5 1.5H16M8 20H5.5C4.7 20 4 19.3 4 18.5V17"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M7 9h1M10 9h1M13 9h1M16 9h1M6.5 12h2M10 12h1M13 12h2.5M8 15h1M11 15h2M15 15h2"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.8"
                  />
                </svg>
              </HeaderActionButton>
              <HeaderActionButton label={copy.profile.sellBySearch} onClick={onSellBySearch}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle
                    cx="11"
                    cy="11"
                    r="5.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M15.2 15.2 19 19"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.8"
                  />
                </svg>
              </HeaderActionButton>
            </div>
          </div>
          <p className="profile-copy">
            {activityLabel} / {copy.profile.handledBy(userName)}
          </p>
        </div>
        <div className="sell-header__meta">
          <div className="sell-header__total">
            <span>{copy.common.total}</span>
            <strong>{formatCurrency(summary.total, language)}</strong>
          </div>
          {queuedSalesCount > 0 ? (
            <button
              type="button"
              className="queued-offline-button status-pill tone-warning"
              onClick={() => requestOpenOfflineQueue()}
            >
              <span>{copy.common.queuedOffline(queuedSalesCount)}</span>
              <span className="queued-offline-button__dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {feedbackMessage ? <p className="inline-feedback profile-feedback">{feedbackMessage}</p> : null}

      <div className="sale-totals">
        <div>
          <span>{copy.common.paid}</span>
          <strong>{formatCurrency(summary.paid, language)}</strong>
        </div>
        <div>
          <span>{copy.common.debt}</span>
          <strong>{formatCurrency(summary.debt, language)}</strong>
        </div>
        <div>
          <span>{copy.common.credit}</span>
          <strong>{formatCurrency(summary.credit, language)}</strong>
        </div>
      </div>

      <div className="line-list">
        {lines.length === 0 ? <p className="empty-state">{copy.profile.tapToAdd}</p> : null}

        {lines.map((line) => {
          const lineSummary = summarizeLine(line);
          const paymentText = paymentSummaryText(line, copy);
          const pickupText = pickupSummaryText(line, copy);

          return (
            <article key={line.local_id} className="line-summary-card">
              <div className="line-summary-card__header">
                <h3>
                  {line.quantity_units} x {line.product_name}
                </h3>
                <button
                  type="button"
                  className="line-summary-card__remove-button"
                  aria-label={copy.profile.remove}
                  title={copy.profile.remove}
                  onClick={() => onRemoveLine(line.local_id)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M4 7h16M9.5 7V5.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7M8.5 10.5v6M12 10.5v6M15.5 10.5v6M6.8 7l.7 10.2c.1 1 .9 1.8 1.9 1.8h5.2c1 0 1.8-.8 1.9-1.8L17.2 7"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.7"
                    />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                className="line-summary-card__details"
                aria-label={copy.profile.editItem}
                title={copy.profile.editItem}
                onClick={() => setActiveLineId(line.local_id)}
              >
                <div className="line-summary-card__meta">
                  <p>
                    {paymentText} / {pickupText}
                  </p>
                  <span className="line-summary-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M15.1 5.1a2.7 2.7 0 1 1 3.8 3.8L9.3 18.5 5 19l.5-4.3 9.6-9.6Z"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.7"
                      />
                      <path
                        d="m13.8 6.4 3.8 3.8"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.7"
                      />
                    </svg>
                    <span>{copy.profile.editShort}</span>
                  </span>
                </div>
                <div className="line-summary-card__footer">
                  <strong>{formatCurrency(lineSummary.lineTotal, language)}</strong>
                  <PaymentSummary line={line} />
                </div>
              </button>
            </article>
          );
        })}
      </div>

      <LineEditorSheet
        line={activeLine}
        open={Boolean(activeLine)}
        onClose={() => setActiveLineId(null)}
        onLineChange={onLineChange}
        onRemoveLine={onRemoveLine}
      />

      <CustomerDetailsSheet
        customer={customer}
        open={customerSheetOpen}
        isSubmitting={isSubmitting}
        onClose={() => setCustomerSheetOpen(false)}
        onCustomerChange={onCustomerChange}
        onSubmit={onSubmit}
      />

      <AccountingSheet
        accountingDate={accountingDate}
        errorMessage={accountingError}
        isLoading={isLoadingAccounting}
        open={accountingOpen}
        selectedStoreId={accountingStoreId}
        snapshot={accountingSnapshot}
        storeOptions={availableStores}
        canViewAllStores={role === "sysadmin"}
        onClose={() => setAccountingOpen(false)}
        onDateChange={setAccountingDate}
        onStoreChange={setAccountingStoreId}
      />

      <button
        type="button"
        className="primary-button"
        disabled={!lines.length || isSubmitting}
        onClick={handleSubmitClick}
      >
        {isSubmitting ? copy.profile.savingSale : copy.profile.confirmSale}
      </button>
    </section>
  );
}
