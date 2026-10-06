export const APP_VARIANT: "caja" | "full" = (import.meta.env.VITE_APP_VARIANT as "caja" | "full") || "full";
export const esVariantCaja = APP_VARIANT === "caja";
