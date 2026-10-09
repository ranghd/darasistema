// Atajos de teclado: utilidades compartidas.

// true si el usuario esta escribiendo en un campo (no hay que robarle teclas como "?" o "+").
export function escribiendoEnCampo(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Pila de ventanas (modales) abiertas: Esc cierra solo la de arriba.
type Cerrar = { current: () => void };
const pila: Cerrar[] = [];

export function abrirEnPila(cerrar: Cerrar): () => void {
  pila.push(cerrar);
  return () => {
    const i = pila.indexOf(cerrar);
    if (i >= 0) pila.splice(i, 1);
  };
}

export function esTopeDePila(cerrar: Cerrar): boolean {
  return pila[pila.length - 1] === cerrar;
}

export function hayModalAbierto(): boolean {
  return pila.length > 0;
}

// Lista de atajos que se muestra con F1. Cada pantalla puede agregar los suyos.
export interface Atajo {
  teclas: string;
  accion: string;
}

export const ATAJOS_GENERALES: Atajo[] = [
  { teclas: "Ctrl + K", accion: "Buscar pantalla, cliente o factura" },
  { teclas: "F1  o  ?", accion: "Ver esta ayuda de atajos" },
  { teclas: "Esc", accion: "Cerrar la ventana abierta" },
  { teclas: "Ctrl + Enter", accion: "Guardar el formulario" },
  { teclas: "Tab / Shift + Tab", accion: "Pasar al siguiente / anterior campo" },
];

export const ATAJOS_CAJA: Atajo[] = [
  { teclas: "Escribir + Enter", accion: "Buscar y agregar producto (nombre o codigo; sirve el lector de codigos)" },
  { teclas: "3*  y el producto", accion: "Agregar varias unidades de una vez (ej. 3*gas)" },
  { teclas: "↑ / ↓", accion: "Moverse por los resultados o por el carrito" },
  { teclas: "+ / -", accion: "Subir o bajar la cantidad de la linea marcada" },
  { teclas: "Supr", accion: "Quitar la linea marcada" },
  { teclas: "F2", accion: "Elegir cliente" },
  { teclas: "F4", accion: "Cambiar Intercambio / Lleno (envases)" },
  { teclas: "F6 / F7 / F8", accion: "Pago en Efectivo / Tarjeta / Transferencia" },
  { teclas: "F12  o  Ctrl + Enter", accion: "Cobrar" },
  { teclas: "Esc", accion: "Cancelar la venta" },
];
