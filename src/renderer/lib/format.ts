const moneyFormatter = new Intl.NumberFormat("es-DO", {
  style: "currency",
  currency: "DOP",
  currencyDisplay: "symbol",
  minimumFractionDigits: 2,
});

export function formatMoney(value: number | null | undefined): string {
  return moneyFormatter.format(value ?? 0).replace("DOP", "RD$");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("es-DO", { year: "numeric", month: "short", day: "2-digit" });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function firstDayOfMonthIso(): string {
  return `${todayIso().slice(0, 7)}-01`;
}
