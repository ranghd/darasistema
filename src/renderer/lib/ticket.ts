// Recibo de factura para impresoras termicas (58 / 80 mm).
import { api, mensajeDeError } from "./api";
import { html } from "./exportar";
import { formatDate, formatMoney } from "./format";
import { NCF_LABELS } from "./ncf";
import type { Cliente, Cobro, CompanyConfig, ConfigImpresion, FacturaDetalle, ResultadoImpresion, TipoNcf } from "./types";

const METODOS: Record<string, string> = { EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", TARJETA: "Tarjeta", CHEQUE: "Cheque" };

const dinero = (n: number) => formatMoney(n).replace("RD$", "");

export function htmlTicket(f: FacturaDetalle, empresa: CompanyConfig | null, cliente: Cliente | null, cobros: Cobro[], anchoMm: number): string {
  const tipo = (f.ncf?.slice(0, 3) ?? "") as TipoNcf;
  const titulo = NCF_LABELS[tipo]?.split(" - ")[1] ?? "Factura";
  const descuento = f.lineas.reduce((s, l) => s + (l.descuento ?? 0), 0);
  const cobrado = cobros.reduce((s, c) => s + c.monto, 0);
  const lineas = f.lineas
    .map((l) => {
      const bruto = l.cantidad * l.precio_unitario;
      return `<div class="item">${html(l.producto_nombre)}${l.modalidad === "LLENO" ? " (con envase)" : ""}</div>
        <div class="fila"><span>${l.cantidad} x ${dinero(l.precio_unitario)}</span><span>${dinero(bruto)}</span></div>
        ${l.descuento ? `<div class="fila sub"><span>Descuento</span><span>-${dinero(l.descuento)}</span></div>` : ""}`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 2mm 3mm 6mm; width: ${anchoMm}mm; font-family: Arial, "Segoe UI", sans-serif; font-size: ${anchoMm <= 58 ? 10 : 12}px; color: #000; }
    .c { text-align: center; } .b { font-weight: 700; } .grande { font-size: 1.35em; }
    .linea { border-top: 1px dashed #000; margin: 5px 0; }
    .fila { display: flex; justify-content: space-between; gap: 6px; }
    .item { margin-top: 3px; font-weight: 600; } .sub { font-size: 0.9em; }
    .total { font-size: 1.3em; font-weight: 700; }
  </style></head><body>
    <div class="c b grande">${html(empresa?.nombre_empresa ?? "")}</div>
    ${empresa?.rnc ? `<div class="c">RNC: ${html(empresa.rnc)}</div>` : ""}
    ${empresa?.direccion ? `<div class="c">${html(empresa.direccion)}</div>` : ""}
    ${empresa?.telefono ? `<div class="c">Tel: ${html(empresa.telefono)}</div>` : ""}
    <div class="linea"></div>
    <div class="c b">${html(titulo.toUpperCase())}</div>
    <div class="fila"><span>NCF:</span><span class="b">${html(f.ncf ?? "-")}</span></div>
    <div class="fila"><span>Factura No.:</span><span>${f.numero}</span></div>
    <div class="fila"><span>Fecha:</span><span>${formatDate(f.fecha)} ${html(f.creado_en?.slice(11, 16) ?? "")}</span></div>
    <div class="linea"></div>
    <div>Cliente: <span class="b">${html(f.cliente_nombre ?? "")}</span></div>
    ${cliente?.rnc_cedula ? `<div>RNC/Cedula: ${html(cliente.rnc_cedula)}</div>` : ""}
    <div>Pago: ${f.condicion_pago === "CREDITO" ? "Credito" : html(METODOS[f.metodo_pago ?? "EFECTIVO"] ?? "Efectivo")}</div>
    ${f.creado_por ? `<div>Atendido por: ${html(f.creado_por)}</div>` : ""}
    <div class="linea"></div>
    ${lineas}
    <div class="linea"></div>
    <div class="fila"><span>Subtotal</span><span>${dinero(f.subtotal + descuento)}</span></div>
    ${descuento ? `<div class="fila"><span>Descuento</span><span>-${dinero(descuento)}</span></div>` : ""}
    <div class="fila"><span>ITBIS</span><span>${dinero(f.itbis)}</span></div>
    ${f.fianza_total ? `<div class="fila"><span>Deposito envases</span><span>${dinero(f.fianza_total)}</span></div>` : ""}
    <div class="fila total"><span>TOTAL RD$</span><span>${dinero(f.total)}</span></div>
    ${f.condicion_pago === "CREDITO" ? `<div class="fila"><span>Pagado</span><span>${dinero(cobrado)}</span></div><div class="fila b"><span>Pendiente</span><span>${dinero(f.total - cobrado)}</span></div>` : ""}
    ${f.estado === "ANULADA" ? `<div class="linea"></div><div class="c b grande">*** ANULADA ***</div>` : ""}
    ${f.nota_credito_ncf ? `<div>Nota de credito: ${html(f.nota_credito_ncf)}</div>` : ""}
    ${f.nota_debito_ncf ? `<div>Nota de debito: ${html(f.nota_debito_ncf)}</div>` : ""}
    <div class="linea"></div>
    <div class="c">Gracias por su compra</div>
  </body></html>`;
}

export interface AvisoImpresion {
  ok: boolean;
  texto: string;
}

// Texto para el usuario segun lo que Windows confirmo (no decimos "impreso" sin saberlo).
export function avisoDeResultado(r: ResultadoImpresion): AvisoImpresion {
  return r.entregado
    ? { ok: true, texto: `Windows entrego el recibo a la impresora "${r.impresora}". Si no salio el papel, revisa que tenga papel puesto por el lado correcto y la tapa cerrada.` }
    : { ok: true, texto: `Se mando el recibo a "${r.impresora || "la impresora predeterminada"}", pero Windows no confirmo la entrega. Revisa que haya salido.` };
}

// Imprime el recibo de una factura en la impresora de esta computadora.
export async function imprimirReciboFactura(facturaId: number, config?: ConfigImpresion): Promise<AvisoImpresion> {
  try {
    const [cfg, f, empresa, cobros] = await Promise.all([
      config ? Promise.resolve(config) : api.impresion.obtenerConfig(),
      api.facturas.obtener(facturaId) as Promise<FacturaDetalle>,
      api.config.obtener() as Promise<CompanyConfig>,
      api.cobros.listarPorFactura(facturaId) as Promise<Cobro[]>,
    ]);
    const cliente = ((await api.clientes.obtener(f.cliente_id)) as Cliente | undefined) ?? null;
    return avisoDeResultado(await api.impresion.imprimirTicket(htmlTicket(f, empresa, cliente, cobros, cfg.anchoMm)));
  } catch (err) {
    return { ok: false, texto: `No se imprimio: ${mensajeDeError(err, "error desconocido")}` };
  }
}

export function htmlPruebaImpresion(anchoMm: number, nombreEmpresa: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0} body{margin:0;padding:3mm;width:${anchoMm}mm;font-family:Arial,sans-serif;font-size:12px;text-align:center}</style></head>
    <body><b style="font-size:16px">${html(nombreEmpresa)}</b><br>Prueba de impresion<br>Papel de ${anchoMm} mm<br>${new Date().toLocaleString("es-DO")}<br>--------------------------------<br>Si lees esto, la impresora funciona.</body></html>`;
}
