import { api, mensajeDeError } from "../../lib/api";
import { NOMBRE_RESULTADO, TONO_RESULTADO } from "../../lib/caja";
import { html, imprimirDocumento } from "../../lib/exportar";
import { formatMoney } from "../../lib/format";
import { avisoDeResultado, type AvisoImpresion } from "../../lib/ticket";
import type { SesionCaja } from "../../lib/types";
import { Badge } from "../../components/ui";

const hora = (fechaHora: string | null) => (fechaHora ? fechaHora.slice(11, 16) : "-");
const fecha = (fechaHora: string | null) => (fechaHora ? fechaHora.slice(0, 10).split("-").reverse().join("/") : "-");

// Lineas del cuadre de efectivo: de donde sale el "efectivo esperado".
export function lineasEfectivo(s: SesionCaja): [string, number, "+" | "-" | "="][] {
  const r = s.resumen;
  return [
    ["Monto inicial", r.monto_inicial, "+"],
    ["Ventas en efectivo", r.ventas.por_metodo.EFECTIVO, "+"],
    ["Cobros de credito en efectivo", r.cobros.EFECTIVO, "+"],
    ["Entradas de efectivo", r.entradas, "+"],
    ["Salidas de efectivo", r.salidas, "-"],
    ["Reembolsos de envases", r.reembolsos_envases, "-"],
    ["Devoluciones (anulaciones de dias anteriores)", r.devoluciones_efectivo, "-"],
  ];
}

function Fila({ etiqueta, valor, fuerte, signo, tono }: { etiqueta: string; valor: number | string; fuerte?: boolean; signo?: string; tono?: string }) {
  return (
    <div className={`flex justify-between gap-3 py-0.5 ${fuerte ? "font-semibold text-slate-900" : "text-slate-600"}`}>
      <span>{etiqueta}</span>
      <span className={`tabular-nums ${tono ?? ""}`}>
        {signo && signo !== "+" ? `${signo} ` : ""}
        {typeof valor === "number" ? formatMoney(valor) : valor}
      </span>
    </div>
  );
}

export function ResumenCierreVista({ s }: { s: SesionCaja }) {
  const r = s.resumen;
  const v = r.ventas.por_metodo;
  const cerrada = s.estado === "CERRADA";
  const dif = s.diferencia_final ?? 0;
  return (
    <div className="grid grid-cols-1 gap-4 text-sm lg:grid-cols-3">
      <div className="rounded-xl border border-slate-200 p-4">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Jornada</p>
        <Fila etiqueta="Caja" valor={s.caja_nombre ?? "-"} />
        <Fila etiqueta="Fecha" valor={fecha(s.abierta_en)} />
        <Fila etiqueta="Apertura" valor={`${hora(s.abierta_en)} · ${s.abierta_por_nombre}`} />
        <Fila etiqueta="Cierre" valor={cerrada ? `${hora(s.cerrada_en)} · ${s.cerrada_por_nombre}` : "Abierta"} />
        <div className="my-2 border-t border-slate-100" />
        <Fila etiqueta="Facturas realizadas" valor={String(r.ventas.cantidad)} />
        <Fila etiqueta="Facturas anuladas" valor={`${r.anuladas.cantidad} (${formatMoney(r.anuladas.total)})`} />
        <Fila etiqueta="Descuentos" valor={r.ventas.descuentos} />
        <Fila etiqueta="Impuestos (ITBIS)" valor={r.ventas.itbis} />
        <Fila etiqueta="Depositos de envases" valor={r.ventas.fianzas} />
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Ventas por metodo de pago</p>
        <Fila etiqueta="Efectivo" valor={v.EFECTIVO} />
        <Fila etiqueta="Tarjeta" valor={v.TARJETA} />
        <Fila etiqueta="Transferencia" valor={v.TRANSFERENCIA} />
        {v.CHEQUE > 0 && <Fila etiqueta="Cheque" valor={v.CHEQUE} />}
        <Fila etiqueta="A credito (no entra dinero)" valor={v.CREDITO} />
        <div className="my-2 border-t border-slate-100" />
        <Fila etiqueta="Total general vendido" valor={r.ventas.total_general} fuerte />
        {r.cobros.total > 0 && (
          <>
            <div className="my-2 border-t border-slate-100" />
            <p className="text-xs font-semibold uppercase text-slate-400">Cobros de facturas a credito</p>
            {(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CHEQUE"] as const)
              .filter((m) => r.cobros[m] > 0)
              .map((m) => (
                <Fila key={m} etiqueta={m[0] + m.slice(1).toLowerCase()} valor={r.cobros[m]} />
              ))}
          </>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Efectivo en la gaveta</p>
        {lineasEfectivo(s).map(([etq, val, signo]) => (
          <Fila key={etq} etiqueta={etq} valor={val} signo={signo} />
        ))}
        <div className="my-2 border-t border-slate-200" />
        <Fila etiqueta="Efectivo esperado" valor={s.efectivo_esperado ?? r.efectivo_esperado} fuerte />
        {cerrada && (
          <>
            <Fila etiqueta="Efectivo contado" valor={s.efectivo_contado ?? 0} fuerte />
            <Fila etiqueta="Diferencia" valor={s.diferencia ?? 0} fuerte tono={(s.diferencia ?? 0) < 0 ? "text-red-600" : (s.diferencia ?? 0) > 0 ? "text-brand-700" : "text-emerald-700"} />
            {s.correcciones > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                Corregido por administracion: contado {formatMoney(s.efectivo_contado_final)} · diferencia {formatMoney(dif)}
              </div>
            )}
            {s.resultado && (
              <div className="mt-2">
                <Badge tone={TONO_RESULTADO[s.resultado]}>{NOMBRE_RESULTADO[s.resultado]}</Badge>
              </div>
            )}
          </>
        )}
        {s.observaciones && <p className="mt-2 text-xs italic text-slate-500">Observaciones: {s.observaciones}</p>}
      </div>
    </div>
  );
}

// ---------- comprobante imprimible ----------

function htmlComprobante(s: SesionCaja, empresa: string, anchoMm: number | null): string {
  const r = s.resumen;
  const v = r.ventas.por_metodo;
  const fila = (a: string, b: string, fuerte = false) => `<div class="f${fuerte ? " b" : ""}"><span>${html(a)}</span><span>${html(b)}</span></div>`;
  const m = (n: number | null | undefined) => formatMoney(n ?? 0);
  const ticket = anchoMm !== null;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cierre de caja #${s.id}</title><style>
    @page { margin: ${ticket ? "0" : "15mm"}; }
    body { margin: 0; padding: ${ticket ? "2mm 3mm 6mm" : "0"}; ${ticket ? `width: ${anchoMm}mm;` : "max-width: 420px;"} font-family: Arial, sans-serif; font-size: ${ticket && anchoMm! <= 58 ? 10 : 12}px; color: #000; }
    .c { text-align: center; } .b { font-weight: 700; } .t { font-size: 1.3em; }
    .f { display: flex; justify-content: space-between; gap: 8px; } .l { border-top: 1px dashed #000; margin: 5px 0; }
  </style></head><body>
    <div class="c b t">${html(empresa)}</div>
    <div class="c b">CIERRE DE CAJA #${s.id}</div>
    <div class="c">${html(s.caja_nombre ?? "")}</div>
    <div class="l"></div>
    ${fila("Fecha", fecha(s.abierta_en))}
    ${fila("Apertura", `${hora(s.abierta_en)} - ${s.abierta_por_nombre}`)}
    ${fila("Cierre", `${hora(s.cerrada_en)} - ${s.cerrada_por_nombre ?? ""}`)}
    <div class="l"></div>
    ${fila("Facturas", String(r.ventas.cantidad))}
    ${fila("Anuladas", `${r.anuladas.cantidad} (${m(r.anuladas.total)})`)}
    ${fila("Efectivo", m(v.EFECTIVO))}
    ${fila("Tarjeta", m(v.TARJETA))}
    ${fila("Transferencia", m(v.TRANSFERENCIA))}
    ${v.CHEQUE ? fila("Cheque", m(v.CHEQUE)) : ""}
    ${fila("Credito", m(v.CREDITO))}
    ${fila("Descuentos", m(r.ventas.descuentos))}
    ${fila("ITBIS", m(r.ventas.itbis))}
    ${fila("TOTAL VENDIDO", m(r.ventas.total_general), true)}
    ${r.cobros.total ? fila("Cobros de credito", m(r.cobros.total)) : ""}
    <div class="l"></div>
    ${lineasEfectivo(s)
      .filter(([, val], i) => i === 0 || val)
      .map(([etq, val, signo]) => fila(etq, `${signo === "-" ? "- " : ""}${m(val)}`))
      .join("")}
    <div class="l"></div>
    ${fila("Efectivo esperado", m(s.efectivo_esperado), true)}
    ${fila("Efectivo contado", m(s.efectivo_contado), true)}
    ${fila("Diferencia", m(s.diferencia), true)}
    <div class="c b">${s.resultado ? NOMBRE_RESULTADO[s.resultado].toUpperCase() : ""}</div>
    ${s.correcciones ? `<div class="l"></div>${fila("Corregido: contado", m(s.efectivo_contado_final))}${fila("Corregido: diferencia", m(s.diferencia_final))}` : ""}
    ${s.observaciones ? `<div class="l"></div><div>Obs.: ${html(s.observaciones)}</div>` : ""}
    <div class="l"></div>
    <br><br><div class="c">_______________________</div><div class="c">Firma del cajero</div>
  </body></html>`;
}

// Imprime el comprobante en la impresora de recibos o en hoja carta, segun Configuracion.
export async function imprimirComprobanteCierre(s: SesionCaja): Promise<AvisoImpresion> {
  try {
    const [cfg, empresa] = await Promise.all([api.impresion.obtenerConfig(), api.config.obtener()]);
    const nombre = (empresa as any)?.nombre_empresa ?? "";
    if (cfg.formato === "TICKET") return avisoDeResultado(await api.impresion.imprimirTicket(htmlComprobante(s, nombre, cfg.anchoMm)));
    imprimirDocumento(htmlComprobante(s, nombre, null));
    return { ok: true, texto: "Se abrio la ventana de impresion." };
  } catch (err) {
    return { ok: false, texto: `No se imprimio: ${mensajeDeError(err, "error desconocido")}` };
  }
}
