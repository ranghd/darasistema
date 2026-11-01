import type { Producto } from "./types";

// Otros precios de un producto (Gas Damian): por mayor, especial... El precio va sin ITBIS, como el principal.
export interface PrecioExtra {
  nombre: string;
  precio: number;
}

export function leerPrecios(p: Pick<Producto, "precios_extra"> | undefined | null): PrecioExtra[] {
  if (!p?.precios_extra) return [];
  try {
    const lista = JSON.parse(p.precios_extra);
    return Array.isArray(lista) ? lista.filter((x) => x && x.nombre && Number(x.precio) > 0) : [];
  } catch {
    return [];
  }
}
