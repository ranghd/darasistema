// Que edicion del sistema es este programa (se fija al compilar con VITE_APP_VARIANT):
//   full        = Darasistema (oficina del negocio de gas, oxigeno y agua)
//   caja        = Cajapunto1 (la caja del negocio de gas)
//   colmado     = Darasistema Colmado (la oficina del colmado)
//   cajacolmado = Cajapunto1 Colmado (la caja del colmado: factura rapida en tabla)
export type Variante = "caja" | "full" | "colmado" | "cajacolmado";
export const APP_VARIANT: Variante = (import.meta.env.VITE_APP_VARIANT as Variante) || "full";
// Es el programa de la caja (pantallas de cajero; la oficina queda en el otro programa).
export const esVariantCaja = APP_VARIANT === "caja" || APP_VARIANT === "cajacolmado";
// Es para un colmado (productos con grupo y codigo de barras, sin envases).
export const esColmado = APP_VARIANT === "colmado" || APP_VARIANT === "cajacolmado";
// Abre, opera y cierra la caja en esta computadora.
export const operaCaja = esVariantCaja || esColmado;
// Maneja cilindros y botellones retornables (con fianza).
export const manejaEnvases = !esColmado;

const EDICIONES = {
  full: { nombre: "Darasistema", lema: "Gas · Oxigeno · Agua" },
  caja: { nombre: "Cajapunto1", lema: "Gas · Oxigeno · Agua" },
  colmado: { nombre: "Darasistema Colmado", lema: "Administracion del colmado" },
  cajacolmado: { nombre: "Cajapunto1 Colmado", lema: "Facturacion rapida" },
} as const;
export const EDICION = EDICIONES[APP_VARIANT];

// Grupos que se sugieren al crear productos en un colmado.
export const GRUPOS_COLMADO = ["Viveres", "Bebidas", "Lacteos", "Embutidos", "Carnes", "Panaderia", "Limpieza", "Higiene personal", "Picaderas", "Licores", "Frutas y vegetales", "Otros"];
