import { useEffect, useMemo, useState } from "react";
import { api, mensajeDeError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCaja } from "../lib/caja";
import { formatDate, formatMoney, todayIso } from "../lib/format";
import { html, imprimirHtml } from "../lib/exportar";
import type { Banco, FacturaPendiente, ReciboDetalle } from "../lib/types";
import { Badge, Button, Input, Modal, Select } from "./ui";
import { tonoDias } from "./reportes";

const METODOS: [string, string][] = [
  ["EFECTIVO", "Efectivo"],
  ["TRANSFERENCIA", "Transferencia"],
  ["CHEQUE", "Cheque"],
  ["TARJETA", "Tarjeta"],
];
const nombreMetodo = (m: string) => METODOS.find(([k]) => k === m)?.[1] ?? m;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (t: string) => Number(String(t).replace(/,/g, "")) || 0;

// Reparte un monto entre las facturas, de la mas vieja a la mas nueva.
function repartir(monto: number, facturas: FacturaPendiente[]): Record<number, string> {
  const r: Record<number, string> = {};
  let resto = r2(monto);
  for (const f of facturas) {
    const parte = r2(Math.max(0, Math.min(resto, f.saldo)));
    r[f.id] = parte > 0 ? String(parte) : "";
    resto = r2(resto - parte);
  }
  return r;
}

export function imprimirRecibo(r: ReciboDetalle, empresa?: { nombre_empresa?: string; rnc?: string | null; telefono?: string | null } | null) {
  const filas = r.aplicaciones
    .map(
      (a) => `<tr><td>${html(a.ncf ?? `#${a.numero}`)}</td><td>${formatDate(a.fecha)}</td><td class="r">${formatMoney(a.total)}</td>
        <td class="r">${formatMoney(a.monto)}</td><td class="r">${formatMoney(a.saldo_despues)}</td></tr>`
    )
    .join("");
  imprimirHtml(
    `Recibo de cobro #${r.numero}`,
    `<div class="doc">
      <div style="display:flex;justify-content:space-between">
        <div><h2>${html(empresa?.nombre_empresa ?? "")}</h2><div class="muted">${empresa?.rnc ? `RNC ${html(empresa.rnc)}` : ""} ${empresa?.telefono ? `· Tel. ${html(empresa.telefono)}` : ""}</div></div>
        <div style="text-align:right"><h2>Recibo de cobro No. ${r.numero}</h2><div>${formatDate(r.fecha)}</div></div>
      </div>
      <p>Recibimos de <b>${html(r.cliente_nombre)}</b>${r.cliente_rnc ? ` (${html(r.cliente_rnc)})` : ""} la suma de <b>${formatMoney(r.monto)}</b>
        en ${html(nombreMetodo(r.metodo))}${r.banco_nombre && r.metodo !== "EFECTIVO" ? ` · ${html(r.banco_nombre)}` : ""}${r.referencia ? ` · Ref. ${html(r.referencia)}` : ""}.</p>
      <table><thead><tr><th>Factura</th><th>Fecha</th><th class="r">Total factura</th><th class="r">Pagado ahora</th><th class="r">Queda debiendo</th></tr></thead><tbody>${filas}</tbody></table>
      <div class="totales"><div class="fuerte"><span>Total recibido</span><span>${formatMoney(r.monto)}</span></div></div>
      ${r.nota ? `<p class="muted">Nota: ${html(r.nota)}</p>` : ""}
      <div style="display:flex;justify-content:space-between;margin-top:56px">
        <div style="border-top:1px solid #94a3b8;width:220px;text-align:center;padding-top:4px">Recibido por${r.creado_por ? `: ${html(r.creado_por)}` : ""}</div>
        <div style="border-top:1px solid #94a3b8;width:220px;text-align:center;padding-top:4px">Firma del cliente</div>
      </div>
    </div>`
  );
}

export default function ReciboCobroModal({
  open,
  onClose,
  cliente,
  onGuardado,
}: {
  open: boolean;
  onClose: () => void;
  cliente: { id: number; nombre: string } | null;
  onGuardado?: (r: ReciboDetalle) => void;
}) {
  const { usuario } = useAuth();
  const { sesion, usaCaja } = useCaja();
  const [facturas, setFacturas] = useState<FacturaPendiente[]>([]);
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [monto, setMonto] = useState("");
  const [aplicar, setAplicar] = useState<Record<number, string>>({});
  const [metodo, setMetodo] = useState("EFECTIVO");
  const [bancoId, setBancoId] = useState<number | "">("");
  const [referencia, setReferencia] = useState("");
  const [nota, setNota] = useState("");
  const [fecha, setFecha] = useState(todayIso());
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState<ReciboDetalle | null>(null);

  useEffect(() => {
    if (!open || !cliente) return;
    setMonto("");
    setAplicar({});
    setMetodo("EFECTIVO");
    setReferencia("");
    setNota("");
    setFecha(todayIso());
    setError("");
    setHecho(null);
    api.recibos.pendientes(cliente.id).then(setFacturas);
    api.bancos.listar().then((b) => {
      const activos = b.filter((x) => x.activo);
      setBancos(activos);
      setBancoId(activos[0]?.id ?? "");
    });
  }, [open, cliente?.id]);

  const deuda = r2(facturas.reduce((s, f) => s + f.saldo, 0));
  const aplicado = r2(Object.values(aplicar).reduce((s, v) => s + num(v), 0));
  const recibido = r2(num(monto));
  const cuadra = recibido > 0 && Math.abs(aplicado - recibido) < 0.005;

  function cambiarMonto(t: string) {
    setMonto(t);
    setAplicar(repartir(num(t), facturas));
  }

  function marcar(f: FacturaPendiente, si: boolean) {
    const nuevo = { ...aplicar, [f.id]: si ? String(f.saldo) : "" };
    setAplicar(nuevo);
    setMonto(String(r2(Object.values(nuevo).reduce((s, v) => s + num(v), 0))) || "");
  }

  const empresaPromesa = useMemo(() => (open ? api.config.obtener() : null), [open]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente) return;
    setError("");
    if (!(recibido > 0)) return setError("Escribe cuanto pago el cliente");
    if (recibido > deuda + 0.005) return setError(`El cliente solo debe ${formatMoney(deuda)}`);
    if (!cuadra) return setError(`Lo repartido (${formatMoney(aplicado)}) debe ser igual a lo recibido (${formatMoney(recibido)})`);
    if (usaCaja && metodo === "EFECTIVO" && !sesion) return setError("La caja esta cerrada: para cobrar en efectivo abre la caja primero.");
    setGuardando(true);
    try {
      const r = await api.recibos.crear({
        cliente_id: cliente.id,
        fecha,
        monto: recibido,
        metodo: metodo as any,
        banco_id: metodo === "EFECTIVO" ? null : bancoId || null,
        referencia,
        nota,
        aplicaciones: facturas.filter((f) => num(aplicar[f.id] ?? "") > 0).map((f) => ({ factura_id: f.id, monto: r2(num(aplicar[f.id])) })),
        caja_sesion_id: sesion?.id ?? null,
        creado_por: usuario?.nombre,
      });
      setHecho(r);
      onGuardado?.(r);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={hecho ? `Recibo No. ${hecho.numero}` : `Recibo de cobro · ${cliente?.nombre ?? ""}`} width="max-w-3xl">
      {hecho ? (
        <div className="space-y-4 text-sm">
          <div className="rounded-xl bg-emerald-50 p-4 text-emerald-800">
            <p className="text-base font-semibold">Cobro registrado: {formatMoney(hecho.monto)}</p>
            <p>
              Se aplico a {hecho.aplicaciones.length} factura{hecho.aplicaciones.length === 1 ? "" : "s"} de {hecho.cliente_nombre}.
            </p>
          </div>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {hecho.aplicaciones.map((a) => (
              <li key={a.factura_id} className="flex justify-between px-3 py-2">
                <span className="font-mono text-xs">{a.ncf ?? `#${a.numero}`}</span>
                <span>
                  {formatMoney(a.monto)} <span className="text-slate-400">· queda {formatMoney(a.saldo_despues)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={async () => imprimirRecibo(hecho, await empresaPromesa)}>
              Imprimir recibo
            </Button>
            <Button onClick={onClose}>Listo</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={guardar} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>
              Debe en total <b className="text-base">{formatMoney(deuda)}</b> en {facturas.length} factura{facturas.length === 1 ? "" : "s"}
            </span>
            <button type="button" className="text-xs font-semibold underline" onClick={() => cambiarMonto(String(deuda))}>
              Paga todo
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Monto recibido (RD$)" inputMode="decimal" autoFocus value={monto} onChange={(e) => cambiarMonto(e.target.value)} placeholder="0.00" />
            <Select label="Forma de pago" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {METODOS.map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </Select>
            <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          {metodo !== "EFECTIVO" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Entro al banco" value={bancoId} onChange={(e) => setBancoId(Number(e.target.value))}>
                {bancos.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nombre}
                    {b.numero_cuenta ? ` · ${b.numero_cuenta}` : ""}
                  </option>
                ))}
              </Select>
              <Input
                label={metodo === "CHEQUE" ? "Numero de cheque" : "Numero de referencia"}
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="Sirve para cuadrar con el banco"
              />
            </div>
          )}

          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">A que facturas va el pago</p>
            <p className="mb-2 text-xs text-slate-500">Se reparte solo, de la mas vieja a la mas nueva. Puedes marcar otras o cambiar los montos.</p>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left"></th>
                    <th className="px-3 py-2 text-left">Factura</th>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Dias</th>
                    <th className="px-3 py-2 text-right">Debe</th>
                    <th className="px-3 py-2 text-right">Aplicar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {facturas.map((f) => (
                    <tr key={f.id}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={num(aplicar[f.id] ?? "") > 0} onChange={(e) => marcar(f, e.target.checked)} />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{f.ncf ?? `#${f.numero}`}</td>
                      <td className="px-3 py-1.5">{formatDate(f.fecha)}</td>
                      <td className="px-3 py-1.5">
                        <Badge tone={tonoDias(f.dias)}>{f.dias}d</Badge>
                      </td>
                      <td className="px-3 py-1.5 text-right">{formatMoney(f.saldo)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          inputMode="decimal"
                          value={aplicar[f.id] ?? ""}
                          onChange={(e) => {
                            const nuevo = { ...aplicar, [f.id]: e.target.value };
                            setAplicar(nuevo);
                          }}
                          className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right"
                          placeholder="0.00"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`mt-2 flex justify-end gap-4 text-sm ${cuadra || !recibido ? "text-slate-600" : "text-red-600"}`}>
              <span>Repartido: {formatMoney(aplicado)}</span>
              <span>Recibido: {formatMoney(recibido)}</span>
            </div>
          </div>

          <Input label="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando || facturas.length === 0}>
              {guardando ? "Guardando..." : `Registrar cobro ${recibido ? formatMoney(recibido) : ""}`}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
