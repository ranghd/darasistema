import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { descargarCsv, imprimirTabla } from "../../lib/exportar";
import type { CxcCliente, ReciboCobro } from "../../lib/types";
import { Badge, Button, EmptyRow, PageHeader, StatCard, Table } from "../../components/ui";
import { BotonesExportar, Pestanas, tonoDias } from "../../components/reportes";
import ReciboCobroModal, { imprimirRecibo } from "../../components/ReciboCobro";

interface Fila {
  id: number;
  numero: number;
  ncf: string;
  fecha: string;
  cliente_id: number;
  cliente_nombre: string;
  total: number;
  cobrado: number;
  dias: number;
}

type Vista = "CLIENTES" | "FACTURAS" | "RECIBOS";
const METODOS: Record<string, string> = { EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", TARJETA: "Tarjeta", CHEQUE: "Cheque" };
const n2 = (n: number) => Math.round(n * 100) / 100;

export default function CuentasPorCobrar() {
  const [vista, setVista] = useState<Vista>("CLIENTES");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [clientes, setClientes] = useState<CxcCliente[]>([]);
  const [recibos, setRecibos] = useState<ReciboCobro[]>([]);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [cobrar, setCobrar] = useState<{ id: number; nombre: string } | null>(null);
  const [empresa, setEmpresa] = useState<any>(null);
  const [buscar, setBuscar] = useState("");

  async function cargar() {
    // Si una de las listas falla, las demas igual se muestran (antes todo quedaba en cero).
    const [f, c, r] = await Promise.allSettled([api.reportes.cuentasPorCobrar(), api.reportes.cxcPorCliente(), api.recibos.listar()]);
    if (f.status === "fulfilled") setFilas(f.value as Fila[]);
    if (c.status === "fulfilled") setClientes(c.value);
    if (r.status === "fulfilled") setRecibos(r.value);
  }

  useEffect(() => {
    cargar();
    api.config.obtener().then(setEmpresa);
  }, []);

  const totalPendiente = clientes.reduce((s, c) => s + c.total_adeudado, 0);
  const mas30 = clientes.reduce((s, c) => s + c.b31_60 + c.b61_90 + c.b90, 0);
  const mas90 = clientes.reduce((s, c) => s + c.b90, 0);
  const q = buscar.trim().toLowerCase();
  const clientesVista = clientes.filter((c) => !q || c.cliente_nombre.toLowerCase().includes(q));
  const facturasVista = filas.filter((f) => !q || f.cliente_nombre.toLowerCase().includes(q) || (f.ncf ?? "").toLowerCase().includes(q));
  const recibosVista = recibos.filter((r) => !q || (r.cliente_nombre ?? "").toLowerCase().includes(q) || String(r.numero) === q);
  const sum = (k: keyof CxcCliente) => n2(clientesVista.reduce((s, c) => s + Number(c[k]), 0));

  function exportar(imprimir: boolean) {
    const sub = `Al ${formatDate(todayIso())}`;
    if (vista === "CLIENTES") {
      const enc = ["Cliente", "Telefono", "Facturas", "0-30 dias", "31-60 dias", "61-90 dias", "Mas de 90", "Total adeudado"];
      const datos = clientesVista.map((c) => [c.cliente_nombre, c.telefono ?? "", c.facturas, c.b0_30, c.b31_60, c.b61_90, c.b90, c.total_adeudado]);
      if (!imprimir) return descargarCsv("cxc-por-cliente.csv", enc, datos);
      return imprimirTabla({
        titulo: "Cuentas por Cobrar por cliente",
        subtitulo: sub,
        empresa: empresa?.nombre_empresa,
        encabezados: enc,
        derecha: [2, 3, 4, 5, 6, 7],
        filas: clientesVista.map((c) => [c.cliente_nombre, c.telefono ?? "", c.facturas, formatMoney(c.b0_30), formatMoney(c.b31_60), formatMoney(c.b61_90), formatMoney(c.b90), formatMoney(c.total_adeudado)]),
        pie: ["TOTAL", "", sum("facturas"), formatMoney(sum("b0_30")), formatMoney(sum("b31_60")), formatMoney(sum("b61_90")), formatMoney(sum("b90")), formatMoney(sum("total_adeudado"))],
      });
    }
    if (vista === "FACTURAS") {
      const enc = ["NCF", "Fecha", "Cliente", "Total", "Cobrado", "Saldo", "Dias"];
      if (!imprimir) return descargarCsv("cxc-por-factura.csv", enc, facturasVista.map((f) => [f.ncf, f.fecha, f.cliente_nombre, f.total, f.cobrado, n2(f.total - f.cobrado), f.dias]));
      return imprimirTabla({
        titulo: "Cuentas por Cobrar por factura",
        subtitulo: sub,
        empresa: empresa?.nombre_empresa,
        encabezados: enc,
        derecha: [3, 4, 5, 6],
        filas: facturasVista.map((f) => [f.ncf, formatDate(f.fecha), f.cliente_nombre, formatMoney(f.total), formatMoney(f.cobrado), formatMoney(f.total - f.cobrado), f.dias]),
        pie: ["TOTAL", "", "", "", "", formatMoney(facturasVista.reduce((s, f) => s + f.total - f.cobrado, 0)), ""],
      });
    }
    const enc = ["Recibo", "Fecha", "Cliente", "Forma de pago", "Referencia", "Facturas", "Monto"];
    if (!imprimir) return descargarCsv("recibos-de-cobro.csv", enc, recibosVista.map((r) => [r.numero, r.fecha, r.cliente_nombre, METODOS[r.metodo], r.referencia ?? "", r.facturas, r.monto]));
    return imprimirTabla({
      titulo: "Recibos de cobro",
      empresa: empresa?.nombre_empresa,
      encabezados: enc,
      derecha: [5, 6],
      filas: recibosVista.map((r) => [r.numero, formatDate(r.fecha), r.cliente_nombre ?? "", METODOS[r.metodo], r.referencia ?? "", r.facturas ?? 0, formatMoney(r.monto)]),
      pie: ["TOTAL", "", "", "", "", "", formatMoney(recibosVista.reduce((s, r) => s + r.monto, 0))],
    });
  }

  return (
    <div>
      <PageHeader
        title="Cuentas por Cobrar"
        subtitle="Lo que te deben los clientes, el total de cada uno y por antiguedad"
        actions={<BotonesExportar onExcel={() => exportar(false)} onImprimir={() => exportar(true)} />}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Total por cobrar" value={formatMoney(totalPendiente)} tone="amber" hint={`${filas.length} facturas`} />
        <StatCard label="Clientes que deben" value={String(clientes.length)} />
        <StatCard label="Con mas de 30 dias" value={formatMoney(mas30)} tone={mas30 > 0 ? "red" : "slate"} />
        <StatCard label="Con mas de 90 dias" value={formatMoney(mas90)} tone={mas90 > 0 ? "red" : "slate"} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <Pestanas<Vista>
          opciones={[
            ["CLIENTES", "Por cliente (total acumulado)"],
            ["FACTURAS", "Por factura"],
            ["RECIBOS", "Recibos de cobro"],
          ]}
          valor={vista}
          onChange={setVista}
        />
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar cliente o NCF..."
          className="mb-4 w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {vista === "CLIENTES" && (
        <Table columns={["Cliente", "Facturas", "0-30 dias", "31-60 dias", "61-90 dias", "Mas de 90", "Total adeudado", ""]}>
          {clientesVista.length === 0 && <EmptyRow colSpan={8} label="Nadie te debe" />}
          {clientesVista.map((c) => (
            <Fragment key={c.cliente_id}>
              <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setAbierto(abierto === c.cliente_id ? null : c.cliente_id)}>
                <td className="px-4 py-2">
                  <span className="mr-1 text-slate-400">{abierto === c.cliente_id ? "▾" : "▸"}</span>
                  <span className="font-medium text-slate-800">{c.cliente_nombre}</span>
                  {c.telefono && <span className="ml-2 text-xs text-slate-400">{c.telefono}</span>}
                </td>
                <td className="px-4 py-2 text-center">{c.facturas}</td>
                <td className="px-4 py-2 text-right">{c.b0_30 ? formatMoney(c.b0_30) : "-"}</td>
                <td className="px-4 py-2 text-right text-amber-600">{c.b31_60 ? formatMoney(c.b31_60) : "-"}</td>
                <td className="px-4 py-2 text-right text-red-500">{c.b61_90 ? formatMoney(c.b61_90) : "-"}</td>
                <td className="px-4 py-2 text-right font-medium text-red-600">{c.b90 ? formatMoney(c.b90) : "-"}</td>
                <td className="px-4 py-2 text-right text-base font-semibold text-slate-900">{formatMoney(c.total_adeudado)}</td>
                <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" onClick={() => setCobrar({ id: c.cliente_id, nombre: c.cliente_nombre })}>
                    Cobrar
                  </Button>
                </td>
              </tr>
              {abierto === c.cliente_id && (
                <tr className="bg-slate-50/70">
                  <td colSpan={8} className="px-10 py-3">
                    <table className="w-full text-xs">
                      <thead className="text-slate-500">
                        <tr>
                          <th className="py-1 text-left">NCF</th>
                          <th className="py-1 text-left">Fecha</th>
                          <th className="py-1 text-right">Total</th>
                          <th className="py-1 text-right">Cobrado</th>
                          <th className="py-1 text-right">Saldo</th>
                          <th className="py-1 text-right">Dias</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filas
                          .filter((f) => f.cliente_id === c.cliente_id)
                          .map((f) => (
                            <tr key={f.id} className="border-t border-slate-200">
                              <td className="py-1 font-mono">{f.ncf}</td>
                              <td className="py-1">{formatDate(f.fecha)}</td>
                              <td className="py-1 text-right">{formatMoney(f.total)}</td>
                              <td className="py-1 text-right text-emerald-600">{formatMoney(f.cobrado)}</td>
                              <td className="py-1 text-right font-semibold text-amber-600">{formatMoney(f.total - f.cobrado)}</td>
                              <td className="py-1 text-right">
                                <Badge tone={tonoDias(f.dias)}>{f.dias}d</Badge>
                              </td>
                              <td className="py-1 text-right">
                                <Link to={`/facturas/${f.id}`} className="font-medium text-brand-600 hover:underline">
                                  Ver
                                </Link>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {clientesVista.length > 0 && (
            <tr className="bg-slate-50 font-semibold">
              <td className="px-4 py-2">TOTAL</td>
              <td className="px-4 py-2 text-center">{sum("facturas")}</td>
              <td className="px-4 py-2 text-right">{formatMoney(sum("b0_30"))}</td>
              <td className="px-4 py-2 text-right">{formatMoney(sum("b31_60"))}</td>
              <td className="px-4 py-2 text-right">{formatMoney(sum("b61_90"))}</td>
              <td className="px-4 py-2 text-right">{formatMoney(sum("b90"))}</td>
              <td className="px-4 py-2 text-right text-base">{formatMoney(sum("total_adeudado"))}</td>
              <td></td>
            </tr>
          )}
        </Table>
      )}

      {vista === "FACTURAS" && (
        <Table columns={["NCF", "Fecha", "Cliente", "Total", "Cobrado", "Saldo", "Dias", ""]}>
          {facturasVista.length === 0 && <EmptyRow colSpan={8} label="No hay cuentas pendientes" />}
          {facturasVista.map((f) => (
            <tr key={f.id}>
              <td className="px-4 py-2 font-mono text-xs">{f.ncf}</td>
              <td className="px-4 py-2">{formatDate(f.fecha)}</td>
              <td className="px-4 py-2 font-medium text-slate-800">{f.cliente_nombre}</td>
              <td className="px-4 py-2 text-right">{formatMoney(f.total)}</td>
              <td className="px-4 py-2 text-right text-emerald-600">{formatMoney(f.cobrado)}</td>
              <td className="px-4 py-2 text-right font-semibold text-amber-600">{formatMoney(f.total - f.cobrado)}</td>
              <td className="px-4 py-2">
                <Badge tone={tonoDias(f.dias)}>{f.dias}d</Badge>
              </td>
              <td className="px-4 py-2 text-right">
                <Link to={`/facturas/${f.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                  Ver
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {vista === "RECIBOS" && (
        <Table columns={["Recibo", "Fecha", "Cliente", "Forma de pago", "Referencia", "Facturas", "Monto", ""]}>
          {recibosVista.length === 0 && <EmptyRow colSpan={8} label="Todavia no hay recibos de cobro" />}
          {recibosVista.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2 font-mono text-xs">#{r.numero}</td>
              <td className="px-4 py-2">{formatDate(r.fecha)}</td>
              <td className="px-4 py-2 font-medium text-slate-800">{r.cliente_nombre}</td>
              <td className="px-4 py-2">
                {METODOS[r.metodo]}
                {r.banco_nombre && r.metodo !== "EFECTIVO" ? <span className="text-xs text-slate-400"> · {r.banco_nombre}</span> : null}
              </td>
              <td className="px-4 py-2 font-mono text-xs">{r.referencia ?? "-"}</td>
              <td className="px-4 py-2 text-center">{r.facturas}</td>
              <td className="px-4 py-2 text-right font-semibold">{formatMoney(r.monto)}</td>
              <td className="px-4 py-2 text-right">
                <button
                  className="text-xs font-medium text-brand-600 hover:underline"
                  onClick={async () => {
                    const d = await api.recibos.obtener(r.id);
                    if (d) imprimirRecibo(d, empresa);
                  }}
                >
                  Imprimir
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <ReciboCobroModal
        open={!!cobrar}
        cliente={cobrar}
        onClose={() => setCobrar(null)}
        onGuardado={() => cargar()}
      />
    </div>
  );
}
