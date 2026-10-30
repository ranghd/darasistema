// Factura en hoja carta (Gas Damian): ITBIS de cada producto y, al final,
// "Entregado por" y "Recibido por" con espacio para la firma y la cedula de quien recibe.
import { api, mensajeDeError } from "./api";
import { html } from "./exportar";
import { formatDate, formatMoney } from "./format";
import { NCF_LABELS } from "./ncf";
import type { Cliente, CompanyConfig, FacturaDetalle, TipoNcf } from "./types";
import type { AvisoImpresion } from "./ticket";
import logo from "../assets/gas-damian.png?inline";

const METODOS: Record<string, string> = { EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", TARJETA: "Tarjeta", CHEQUE: "Cheque" };

export function htmlFacturaCarta(f: FacturaDetalle, empresa: CompanyConfig | null, cliente: Cliente | null): string {
  const tipo = (f.ncf?.slice(0, 3) ?? "") as TipoNcf;
  const titulo = NCF_LABELS[tipo]?.split(" - ")[1] ?? "Factura";
  const descuento = f.lineas.reduce((s, l) => s + (l.descuento ?? 0), 0);
  const filas = f.lineas
    .map((l) => {
      const bruto = l.cantidad * l.precio_unitario - (l.descuento ?? 0);
      return `<tr>
        <td class="n">${l.cantidad}</td>
        <td>${html(l.producto_nombre ?? "")}${l.modalidad === "LLENO" ? ` <span class="nota">(con envase)</span>` : ""}</td>
        <td class="n">${formatMoney(l.precio_unitario)}</td>
        <td class="n">${l.descuento ? formatMoney(l.descuento) : "-"}</td>
        <td class="n">${formatMoney(l.itbis ?? 0)}</td>
        <td class="n b">${formatMoney(bruto + (l.itbis ?? 0))}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Factura ${html(f.ncf ?? String(f.numero))}</title><style>
    @page { size: letter; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, "Segoe UI", sans-serif; font-size: 12px; color: #111; }
    .cab { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #111; padding-bottom: 10px; }
    .empresa { font-size: 20px; font-weight: 700; }
    .marca { display: flex; gap: 12px; align-items: center; }
    .marca img { width: 78px; height: 78px; }
    .gris { color: #555; }
    .doc { text-align: right; }
    .doc .tit { font-size: 15px; font-weight: 700; text-transform: uppercase; }
    .ncf { font-size: 14px; font-weight: 700; margin-top: 4px; }
    .cliente { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin: 14px 0; padding: 10px 12px; border: 1px solid #ccc; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; color: #333; border-bottom: 1.5px solid #111; padding: 6px; }
    td { padding: 7px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
    .n { text-align: right; white-space: nowrap; }
    th.n { text-align: right; }
    .b { font-weight: 700; }
    .nota { color: #555; font-size: 11px; }
    .totales { margin-left: auto; width: 290px; margin-top: 12px; }
    .totales div { display: flex; justify-content: space-between; padding: 3px 0; }
    .totales .total { border-top: 2px solid #111; margin-top: 4px; padding-top: 6px; font-size: 16px; font-weight: 700; }
    .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 50px; margin-top: 70px; page-break-inside: avoid; }
    .firma .linea { border-top: 1px solid #111; padding-top: 5px; margin-top: 46px; font-weight: 700; }
    .firma .campo { margin-top: 26px; border-top: 1px solid #999; padding-top: 4px; color: #333; }
    .pie { margin-top: 30px; text-align: center; color: #555; font-size: 11px; }
    .anulada { margin-top: 10px; text-align: center; font-size: 18px; font-weight: 700; color: #b00; }
  </style></head><body>
    <div class="cab">
      <div class="marca"><img src="${logo}" alt=""><div>
        <div class="empresa">${html(empresa?.nombre_empresa ?? "")}</div>
        ${empresa?.rnc ? `<div>RNC: ${html(empresa.rnc)}</div>` : ""}
        ${empresa?.direccion ? `<div class="gris">${html(empresa.direccion)}</div>` : ""}
        ${empresa?.telefono ? `<div class="gris">Tel: ${html(empresa.telefono)}</div>` : ""}
      </div></div>
      <div class="doc">
        <div class="tit">${html(titulo)}</div>
        <div class="ncf">NCF: ${html(f.ncf ?? "-")}</div>
        <div>Factura No. ${f.numero}</div>
        <div>Fecha: ${formatDate(f.fecha)} ${html(f.creado_en?.slice(11, 16) ?? "")}</div>
      </div>
    </div>
    <div class="cliente">
      <div><span class="gris">Cliente:</span> <b>${html(f.cliente_nombre ?? "")}</b></div>
      <div><span class="gris">RNC / Cedula:</span> ${html(cliente?.rnc_cedula || "-")}</div>
      <div><span class="gris">Telefono:</span> ${html(cliente?.telefono || "-")}</div>
      <div><span class="gris">Forma de pago:</span> ${f.condicion_pago === "CREDITO" ? "Credito" : html(METODOS[f.metodo_pago ?? "EFECTIVO"] ?? "Efectivo")}</div>
      ${cliente?.direccion ? `<div style="grid-column: span 2"><span class="gris">Direccion:</span> ${html(cliente.direccion)}</div>` : ""}
    </div>
    <table>
      <thead><tr><th class="n">Cant.</th><th>Descripcion</th><th class="n">Precio</th><th class="n">Desc.</th><th class="n">ITBIS</th><th class="n">Total</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="totales">
      <div><span>Subtotal</span><span>${formatMoney(f.subtotal + descuento)}</span></div>
      ${descuento ? `<div><span>Descuento</span><span>-${formatMoney(descuento)}</span></div>` : ""}
      <div><span>ITBIS</span><span>${formatMoney(f.itbis)}</span></div>
      ${f.fianza_total ? `<div><span>Deposito de envases</span><span>${formatMoney(f.fianza_total)}</span></div>` : ""}
      <div class="total"><span>TOTAL</span><span>${formatMoney(f.total)}</span></div>
    </div>
    ${f.estado === "ANULADA" ? `<div class="anulada">*** FACTURA ANULADA ***</div>` : ""}
    <div class="firmas">
      <div class="firma">
        <div class="linea">Entregado por</div>
        <div class="gris">${html(f.creado_por ?? "")}</div>
      </div>
      <div class="firma">
        <div class="linea">Recibido por (firma)</div>
        <div class="campo">Cedula:</div>
      </div>
    </div>
    <div class="pie">Gracias por su compra · El mejor gas de Santo Domingo · www.gasdamian.com</div>
  </body></html>`;
}

// Abre el dialogo de imprimir de Windows con la factura en hoja carta.
export async function imprimirFacturaCarta(facturaId: number): Promise<AvisoImpresion> {
  try {
    const [f, empresa] = await Promise.all([api.facturas.obtener(facturaId) as Promise<FacturaDetalle>, api.config.obtener() as Promise<CompanyConfig>]);
    const cliente = ((await api.clientes.obtener(f.cliente_id)) as Cliente | undefined) ?? null;
    const marco = document.createElement("iframe");
    marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(marco);
    const doc = marco.contentDocument!;
    doc.open();
    doc.write(htmlFacturaCarta(f, empresa, cliente));
    doc.close();
    await new Promise((r) => setTimeout(r, 250));
    marco.contentWindow!.focus();
    marco.contentWindow!.print();
    setTimeout(() => marco.remove(), 1000);
    return { ok: true, texto: "Se abrio la ventana de imprimir con la factura en hoja carta." };
  } catch (err) {
    return { ok: false, texto: `No se imprimio: ${mensajeDeError(err, "error desconocido")}` };
  }
}
