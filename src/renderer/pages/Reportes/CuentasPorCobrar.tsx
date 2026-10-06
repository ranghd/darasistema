import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { formatDate, formatMoney } from "../../lib/format";
import { Badge, EmptyRow, PageHeader, StatCard, Table } from "../../components/ui";

interface Fila {
  id: number;
  numero: number;
  ncf: string;
  fecha: string;
  cliente_nombre: string;
  total: number;
  cobrado: number;
  dias: number;
}

export default function CuentasPorCobrar() {
  const [filas, setFilas] = useState<Fila[]>([]);

  useEffect(() => {
    api.reportes.cuentasPorCobrar().then(setFilas as any);
  }, []);

  const totalPendiente = filas.reduce((s, f) => s + (f.total - f.cobrado), 0);
  const vencidas = filas.filter((f) => f.dias > 30).length;

  return (
    <div>
      <PageHeader title="Cuentas por Cobrar" subtitle="Facturas a credito pendientes de cobro" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total pendiente" value={formatMoney(totalPendiente)} tone="amber" />
        <StatCard label="Facturas pendientes" value={String(filas.length)} />
        <StatCard label="Con mas de 30 dias" value={String(vencidas)} tone={vencidas > 0 ? "red" : "slate"} />
      </div>

      <Table columns={["NCF", "Fecha", "Cliente", "Total", "Cobrado", "Saldo", "Dias", ""]}>
        {filas.length === 0 && <EmptyRow colSpan={8} label="No hay cuentas pendientes" />}
        {filas.map((f) => (
          <tr key={f.id}>
            <td className="px-4 py-2 font-mono text-xs">{f.ncf}</td>
            <td className="px-4 py-2">{formatDate(f.fecha)}</td>
            <td className="px-4 py-2 font-medium text-slate-800">{f.cliente_nombre}</td>
            <td className="px-4 py-2 text-right">{formatMoney(f.total)}</td>
            <td className="px-4 py-2 text-right text-emerald-600">{formatMoney(f.cobrado)}</td>
            <td className="px-4 py-2 text-right font-semibold text-amber-600">{formatMoney(f.total - f.cobrado)}</td>
            <td className="px-4 py-2">
              <Badge tone={f.dias > 30 ? "red" : f.dias > 15 ? "amber" : "slate"}>{f.dias}d</Badge>
            </td>
            <td className="px-4 py-2 text-right">
              <Link to={`/facturas/${f.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                Ver
              </Link>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
