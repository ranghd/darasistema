// Busqueda de productos en la caja (la usan la caja con tarjetas y la factura en tabla del colmado).

export const sinAcentos = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// "3*gas" -> 3 unidades de lo que coincida con "gas".
export function leerBusqueda(texto: string): { cantidad: number; q: string } {
  const m = texto.match(/^\s*(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/);
  if (m) return { cantidad: Number(m[1].replace(",", ".")) || 1, q: m[2] };
  return { cantidad: 1, q: texto };
}
