import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { Card, PageHeader, Table } from "../../components/ui";

interface Resultado {
  ingresos: number;
  costos: number;
  utilidadBruta: number;
  gastos: number;
  utilidadNeta: number;
  detalle: { codigo: string; nombre: string; tipo: string; monto: number }[];
}

export default function EstadoResultados() {
  const [data, setData] = useState<Resultado | null>(null);

  useEffect(() => {
    api.reportes.estadoResultados().then(setData as any);
  }, []);

  if (!data) return <p className="text-sm text-slate-400">Cargando...</p>;

  return (
    <div>
      <PageHeader title="Estado de Resultados" subtitle="Ingresos, costos y gastos acumulados (todo el periodo)" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="space-y-2 p-5 text-sm">
          <Row label="Ingresos por ventas" value={data.ingresos} />
          <Row label="Costo de ventas" value={-data.costos} />
          <Row label="Utilidad Bruta" value={data.utilidadBruta} strong />
          <Row label="Gastos operativos" value={-data.gastos} />
          <div className="mt-2 flex justify-between border-t border-slate-300 pt-2 text-base font-bold">
            <span>Utilidad Neta</span>
            <span className={data.utilidadNeta >= 0 ? "text-emerald-600" : "text-red-600"}>{formatMoney(data.utilidadNeta)}</span>
          </div>
        </Card>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Detalle por cuenta</h2>
          <Table columns={["Codigo", "Cuenta", "Categoria", "Monto"]}>
            {data.detalle.map((d) => (
              <tr key={d.codigo}>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{d.codigo}</td>
                <td className="px-4 py-2">{d.nombre}</td>
                <td className="px-4 py-2 text-xs text-slate-400">{d.tipo}</td>
                <td className="px-4 py-2 text-right">{formatMoney(d.monto)}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-slate-200 pt-2 font-semibold" : "text-slate-600"}`}>
      <span>{label}</span>
      <span>{formatMoney(value)}</span>
    </div>
  );
}
