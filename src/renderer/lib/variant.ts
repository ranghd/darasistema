// Que edicion del sistema es este programa (se fija al compilar con VITE_APP_VARIANT):
//   full    = Darasistema (oficina, negocio de gas, oxigeno y agua)
//   caja    = Cajapunto1 (la caja del negocio de gas)
//   colmado = Darasistema Colmado (un solo programa de caja rapida para colmados)
export type Variante = "caja" | "full" | "colmado";
export const APP_VARIANT: Variante = (import.meta.env.VITE_APP_VARIANT as Variante) || "full";
export const esVariantCaja = APP_VARIANT === "caja";
export const esColmado = APP_VARIANT === "colmado";
// Abre, opera y cierra la caja en esta computadora.
export const operaCaja = esVariantCaja || esColmado;
// Maneja cilindros y botellones retornables (con fianza).
export const manejaEnvases = !esColmado;

export const EDICION = esColmado
  ? { nombre: "Darasistema Colmado", lema: "Facturación rápida", rubro: "colmado" as const }
  : esVariantCaja
    ? { nombre: "Cajapunto1", lema: "Gas · Oxigeno · Agua", rubro: "gas" as const }
    : { nombre: "Darasistema", lema: "Gas · Oxigeno · Agua", rubro: "gas" as const };

// Grupos que se sugieren al crear productos en un colmado.
export const GRUPOS_COLMADO = ["Viveres", "Bebidas", "Lacteos", "Embutidos", "Carnes", "Panaderia", "Limpieza", "Higiene personal", "Picaderas", "Licores", "Frutas y vegetales", "Otros"];
