// Que edicion del sistema es este programa (se fija al compilar con VITE_APP_VARIANT):
//   full        = Darasistema (oficina del negocio de gas, oxigeno y agua)
//   caja        = Cajapunto1 (la caja del negocio de gas)
//   colmado     = Darasistema Colmado (la oficina del colmado)
//   cajacolmado = Cajapunto1 Colmado (la caja del colmado: factura rapida en tabla)
//   puntoventa  = Gas Damian (la caja: solo vender y clientes; factura en hoja carta con firmas)
//   puntoventaadmin = Gas Damian Admin (el dueno: todo lo de Darasistema con su logo, factura en hoja carta y cilindros prestados)
//   fritura     = Dara Frituras (la caja: como la de Gas Damian, sin cilindros y con el precio del plato editable en la venta)
//   frituraadmin = Dara Frituras Admin (el dueno: todo lo de Darasistema y los precios cambiados en la caja)
export type Variante = "caja" | "full" | "colmado" | "cajacolmado" | "puntoventa" | "puntoventaadmin" | "fritura" | "frituraadmin";
export const APP_VARIANT: Variante = (import.meta.env.VITE_APP_VARIANT as Variante) || "full";
// Es el programa de la caja (pantallas de cajero; la oficina queda en el otro programa).
export const esVariantCaja = APP_VARIANT === "caja" || APP_VARIANT === "cajacolmado" || APP_VARIANT === "puntoventa" || APP_VARIANT === "fritura";
// Dara Frituras: platos con precio editable en la venta, sin cilindros.
export const esFritura = APP_VARIANT === "fritura" || APP_VARIANT === "frituraadmin";
// Caja sencilla de tarjetas grandes con recibo, categorias, fiados y gastos (Gas Damian y Dara Frituras, la caja y el programa del dueno).
export const soloVentas = APP_VARIANT === "puntoventa" || APP_VARIANT === "puntoventaadmin" || esFritura;
// El programa del dueno de esas ediciones: todo lo de Darasistema, con lo propio de cada una.
export const adminVentas = APP_VARIANT === "puntoventaadmin" || APP_VARIANT === "frituraadmin";
// Negocio sin registrar en la DGII: no cobra ITBIS ni usa NCF, la venta sale como recibo. Cuando se registre, esto pasa a false.
export const sinImpuestos = esFritura;
// La caja de Gas Damian tambien lleva el inventario: productos, categorias, compras y proveedores.
export const cajaConInventario = APP_VARIANT === "puntoventa";
// Esas cajas entran solas: la sesion se recuerda 30 dias y al abrir se revisan las actualizaciones.
export const recuerdaSesion = APP_VARIANT === "puntoventa" || APP_VARIANT === "fritura";
// Es para un colmado (productos con grupo y codigo de barras, sin envases).
export const esColmado = APP_VARIANT === "colmado" || APP_VARIANT === "cajacolmado";
// Abre, opera y cierra la caja en esta computadora.
export const operaCaja = esVariantCaja || esColmado;
// Maneja cilindros y botellones retornables (con fianza).
export const manejaEnvases = !esColmado && !esFritura;

const EDICIONES = {
  full: { nombre: "Darasistema", lema: "Gas · Oxigeno · Agua" },
  caja: { nombre: "Cajapunto1", lema: "Gas · Oxigeno · Agua" },
  colmado: { nombre: "Darasistema Colmado", lema: "Administracion del colmado" },
  cajacolmado: { nombre: "Cajapunto1 Colmado", lema: "Facturacion rapida" },
  puntoventa: { nombre: "Gas Damian", lema: "Oxigeno · Acetileno · Gas propano" },
  puntoventaadmin: { nombre: "Gas Damian Admin", lema: "Oxigeno · Acetileno · Gas propano" },
  fritura: { nombre: "Dara Frituras", lema: "Frituras · Platos · Bebidas" },
  frituraadmin: { nombre: "Dara Frituras Admin", lema: "Frituras · Platos · Bebidas" },
} as const;
export const EDICION = EDICIONES[APP_VARIANT];
// Codigo de empresa en la nube que ya trae escrito el inicio de sesion de Gas Damian.
export const EMPRESA_POR_DEFECTO = soloVentas && !esFritura ? "gasdamian" : "";

// Categorias que se sugieren (pestanas de la caja); el dueno puede escribir otras.
export const CATEGORIAS_SUGERIDAS = esFritura ? ["Platos", "Frituras", "Bebidas", "Extras"] : ["Oxigeno", "Acetileno", "Nitrogeno", "CO2", "Manometros", "Gas propano"];
// La caja agrupa por categoria propia del producto (grupo) en el colmado y en Gas Damian.
export const usaGrupos = esColmado || soloVentas;

// Grupos que se sugieren al crear productos en un colmado.
export const GRUPOS_COLMADO = ["Viveres", "Bebidas", "Lacteos", "Embutidos", "Carnes", "Panaderia", "Limpieza", "Higiene personal", "Picaderas", "Licores", "Frutas y vegetales", "Otros"];
