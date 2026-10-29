// Tipos de comprobante fiscal (NCF) segun la Norma General 06-2018 de la DGII.
// Es la unica lista de codigos y nombres: la usan la base de datos, el sistema,
// la nube y las pantallas. No repetir estos codigos en otro lado.
export const TIPOS_NCF = {
  B01: "Factura de Credito Fiscal",
  B02: "Factura de Consumo",
  B03: "Nota de Debito",
  B04: "Nota de Credito",
  B11: "Comprobante de Compras",
  B12: "Registro Unico de Ingresos",
  B13: "Comprobante para Gastos Menores",
  B14: "Comprobante para Regimenes Especiales",
  B15: "Comprobante Gubernamental",
  B16: "Comprobante para Exportaciones",
  B17: "Comprobante para Pagos al Exterior",
} as const;

export type TipoNcf = keyof typeof TIPOS_NCF;

export const TODOS_LOS_TIPOS_NCF = Object.keys(TIPOS_NCF) as TipoNcf[];

export const NCF_LABELS = Object.fromEntries(TODOS_LOS_TIPOS_NCF.map((t) => [t, `${t} - ${TIPOS_NCF[t]}`])) as Record<TipoNcf, string>;

// Los que se pueden escoger al hacer una factura de venta.
export const TIPOS_NCF_VENTA = ["B02", "B01", "B14", "B15", "B16"] as const satisfies readonly TipoNcf[];
export type TipoNcfVenta = (typeof TIPOS_NCF_VENTA)[number];

// Los que se emiten en Otros Comprobantes.
export const TIPOS_COMPROBANTE_VARIOS = ["B12", "B13", "B17"] as const satisfies readonly TipoNcf[];
export type TipoComprobanteVarios = (typeof TIPOS_COMPROBANTE_VARIOS)[number];
// El Registro Unico de Ingresos es el unico en que entra dinero; con los demas sale (gasto o pago).
export const TIPO_COMPROBANTE_INGRESO: TipoComprobanteVarios = "B12";

// Antes de la version 2 el sistema tenia los codigos B11 a B16 corridos un lugar
// (decia B11 al Registro Unico de Ingresos, B12 a Gastos Menores, ... B16 a Pagos
// al Exterior). Con esto se corrigen las bases viejas y lo que mande una pantalla vieja.
export const CODIGO_NCF_CORREGIDO: Record<string, TipoNcf> = {
  B11: "B12",
  B12: "B13",
  B13: "B14",
  B14: "B15",
  B15: "B16",
  B16: "B17",
};

// Las pantallas actuales mandan esta version junto al tipo. Si no viene, el pedido
// es de una pantalla de antes de la correccion (una caja o una app que no se ha
// actualizado y esta conectada a la nube o al servidor) y su codigo se traduce.
export const VERSION_CODIGOS_NCF = 2;

export function tipoNcfRecibido(tipo: string, version?: number): string {
  return version === VERSION_CODIGOS_NCF ? tipo : CODIGO_NCF_CORREGIDO[tipo] ?? tipo;
}

// Para los CHECK de la base: 'B01','B02',...
export const listaSql = (tipos: readonly string[]) => tipos.map((t) => `'${t}'`).join(",");
