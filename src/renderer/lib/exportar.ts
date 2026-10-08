// Utilidades para sacar datos de la app: imprimir y descargar en CSV (se abre en Excel).

function escaparHtml(texto: unknown): string {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const html = escaparHtml;

// Imprime un documento propio (sin el menu ni los botones de la app) usando un
// iframe oculto, para poder imprimir varias facturas de una sola vez.
export function imprimirHtml(titulo: string, cuerpo: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escaparHtml(titulo)}</title>
    <style>
      body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 12px; margin: 24px; }
      h1 { font-size: 18px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 0 0 4px; }
      .muted { color: #64748b; } .doc { page-break-inside: avoid; border-bottom: 1px solid #cbd5e1; padding: 14px 0; }
      .doc + .doc { page-break-before: auto; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
      th { font-size: 10px; text-transform: uppercase; color: #475569; }
      .r { text-align: right; } .totales { margin-left: auto; width: 260px; margin-top: 6px; }
      .totales div { display: flex; justify-content: space-between; padding: 1px 0; }
      .fuerte { font-weight: 700; font-size: 13px; border-top: 1px solid #94a3b8; padding-top: 3px; }
    </style></head><body>${cuerpo}</body></html>`);
  doc.close();
  const ventana = iframe.contentWindow!;
  setTimeout(() => {
    ventana.focus();
    ventana.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 150);
}

function celdaCsv(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// Descarga un archivo CSV. Lleva BOM para que Excel muestre bien los acentos.
export function descargarCsv(nombreArchivo: string, encabezados: string[], filas: unknown[][]): void {
  const contenido = [encabezados, ...filas].map((f) => f.map(celdaCsv).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + contenido], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Imprime un documento HTML completo (con sus propios estilos) usando el dialogo de Windows.
export function imprimirDocumento(documentoHtml: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(documentoHtml);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 150);
}
