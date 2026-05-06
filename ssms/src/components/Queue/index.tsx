import { useI18n } from "../../i18nContext";
import { formatCurrency } from "../../utils/sales";
import { PendingItem } from "../../utils/types";
import "./styles.css";

interface QueueProps {
  items: PendingItem[];
  canReorder: boolean;
  onReorder: (items: PendingItem[]) => void;
  onSelectItem?: (item: PendingItem) => void;
}

function pendingTone(item: PendingItem): string {
  if (Number(item.debt_amount) > 0) {
    return "warning";
  }
  if (Number(item.credit_amount) > 0) {
    return "positive";
  }
  if (item.pickup_status === "later") {
    return "neutral";
  }
  return "default";
}

export default function Queue({ items, canReorder, onReorder, onSelectItem }: QueueProps) {
  const { copy, language } = useI18n();

  function pendingLabel(item: PendingItem): string {
    if (Number(item.debt_amount) > 0) {
      return `${copy.common.debt} ${formatCurrency(item.debt_amount, language)}`;
    }
    if (Number(item.credit_amount) > 0) {
      return `${copy.common.credit} ${formatCurrency(item.credit_amount, language)}`;
    }
    if (item.pickup_status === "later") {
      return copy.pending.pickupLater;
    }
    return copy.pending.pending;
  }

  function moveItem(draggedId: number, targetId: number) {
    if (!canReorder || draggedId === targetId) {
      return;
    }

    const nextItems = [...items];
    const draggedIndex = nextItems.findIndex((item) => item.id === draggedId);
    const targetIndex = nextItems.findIndex((item) => item.id === targetId);

    if (draggedIndex < 0 || targetIndex < 0) {
      return;
    }

    const [draggedItem] = nextItems.splice(draggedIndex, 1);
    nextItems.splice(targetIndex, 0, draggedItem);

    onReorder(
      nextItems.map((item, index) => ({
        ...item,
        pending_priority: index + 1,
      }))
    );
  }

  return (
    <section className="pending-board">
      {items.length === 0 ? <p className="empty-state">{copy.pending.noPending}</p> : null}

      {items.map((item) => (
        <article
          key={item.id}
          className={`pending-card${onSelectItem ? " pending-card--interactive" : ""}`}
          draggable={canReorder}
          role={onSelectItem ? "button" : undefined}
          tabIndex={onSelectItem ? 0 : undefined}
          onClick={() => onSelectItem?.(item)}
          onKeyDown={(event) => {
            if (!onSelectItem) {
              return;
            }

            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectItem(item);
            }
          }}
          onDragStart={(event) => {
            if (!canReorder) {
              return;
            }
            event.dataTransfer.setData("text/plain", String(item.id));
          }}
          onDragOver={(event) => {
            if (canReorder) {
              event.preventDefault();
            }
          }}
          onDrop={(event) => {
            if (!canReorder) {
              return;
            }
            event.preventDefault();
            moveItem(Number(event.dataTransfer.getData("text/plain")), item.id);
          }}
        >
          <div className="pending-card__header">
            <div>
              <p className="eyebrow">{copy.common.priority(item.pending_priority)}</p>
              <h3>{item.product_name}</h3>
            </div>
            <span className={`status-pill tone-${pendingTone(item)}`}>{pendingLabel(item)}</span>
          </div>

          <div className="pending-card__details">
            <span>{item.customer_name || copy.pending.walkInCustomer}</span>
            <span>{item.store_name}</span>
            <span>{item.order_number}</span>
          </div>

          <div className="pending-card__footer">
            <strong>{formatCurrency(item.line_total, language)}</strong>
            <p>{item.note || copy.pending.noNote}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
