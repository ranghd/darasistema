import type { TipoNcf } from "./types";

export const NCF_LABELS: Record<TipoNcf, string> = {
  B01: "B01 - Factura de Credito Fiscal",
  B02: "B02 - Factura de Consumo",
  B03: "B03 - Nota de Debito",
  B04: "B04 - Nota de Credito",
  B11: "B11 - Registro Unico de Ingresos",
  B12: "B12 - Registro de Gastos Menores",
  B13: "B13 - Regimenes Especiales",
  B14: "B14 - Comprobante Gubernamental",
  B15: "B15 - Comprobante para Exportaciones",
  B16: "B16 - Comprobante para Pagos al Exterior",
};

export const TIPOS_NCF_VENTA: TipoNcf[] = ["B02", "B01", "B13", "B14", "B15"];
export const TODOS_LOS_TIPOS_NCF: TipoNcf[] = ["B01", "B02", "B03", "B04", "B11", "B12", "B13", "B14", "B15", "B16"];
