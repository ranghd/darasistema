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

// Fecha local (no UTC): en RD, despues de las 8:00 pm toISOString ya daria el dia siguiente.
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function firstDayOfMonthIso(): string {
  return `${todayIso().slice(0, 7)}-01`;
}
