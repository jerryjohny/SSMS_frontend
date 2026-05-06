import { Language, SaleLine } from "./types";

function toNumber(value: number | string): number {
  return Number.parseFloat(String(value || 0)) || 0;
}

function languageToLocale(language: Language): string {
  return language === "pt" ? "pt-MZ" : "en-MZ";
}

export function formatCurrency(value: number | string, language: Language = "en"): string {
  const formatter = new Intl.NumberFormat(languageToLocale(language), {
    style: "currency",
    currency: "MZN",
    minimumFractionDigits: 2,
  });

  return formatter
    .formatToParts(toNumber(value))
    .map((part) => (part.type === "currency" ? "Mzn" : part.value))
    .join("");
}

export function formatDate(value: string, language: Language = "en"): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(languageToLocale(language), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function summarizeLine(line: SaleLine) {
  const quantityUnits = toNumber(line.quantity_units);
  const unitPrice = toNumber(line.unit_price);
  const amountPaid = toNumber(line.amount_paid);
  const lineTotal = quantityUnits * unitPrice;
  const debt = Math.max(lineTotal - amountPaid, 0);
  const credit = Math.max(amountPaid - lineTotal, 0);
  const pending =
    line.pickup_status === "later" ||
    line.payment_status !== "now" ||
    debt > 0 ||
    credit > 0;

  return {
    lineTotal,
    debt,
    credit,
    pending,
  };
}

export function summarizeSale(lines: SaleLine[]) {
  return lines.reduce(
    (summary, line) => {
      const current = summarizeLine(line);
      summary.total += current.lineTotal;
      summary.paid += toNumber(line.amount_paid);
      summary.debt += current.debt;
      summary.credit += current.credit;
      summary.pending = summary.pending || current.pending;
      return summary;
    },
    { total: 0, paid: 0, debt: 0, credit: 0, pending: false }
  );
}

export function requiresCustomer(lines: SaleLine[]): boolean {
  return lines.some((line) => summarizeLine(line).pending);
}
