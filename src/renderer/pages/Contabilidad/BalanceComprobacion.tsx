import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { Badge, EmptyRow, PageHeader, Table } from "../../components/ui";

interface Fila {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  total_debito: number;
  total_credito: number;
}

export default function BalanceComprobacion() {
  const [filas, setFilas] = useState<Fila[]>([]);

  useEffect(() => {
    api.asientos.balanceComprobacion().then(setFilas as any);
  }, []);

  const totalDebito = filas.reduce((s, f) => s + f.total_debito, 0);
  const totalCredito = filas.reduce((s, f) => s + f.total_credito, 0);
  const cuadrado = Math.abs(totalDebito - totalCredito) < 0.01;

  return (
    <div>
      <PageHeader
        title="Balance de Comprobacion"
        subtitle="Suma de debitos y creditos por cuenta: debe cuadrar (partida doble)"
        actions={<Badge tone={cuadrado ? "green" : "red"}>{cuadrado ? "Cuadrado" : "Descuadrado"}</Badge>}
      />

      <Table columns={["Codigo", "Cuenta", "Categoria", "Total Debito", "Total Credito"]}>
        {filas.length === 0 && <EmptyRow colSpan={5} label="Aun no hay movimientos contables" />}
        {filas.map((f) => (
          <tr key={f.id}>
            <td className="px-4 py-2 font-mono text-xs text-slate-500">{f.codigo}</td>
            <td className="px-4 py-2 text-slate-800">{f.nombre}</td>
            <td className="px-4 py-2 text-xs text-slate-400">{f.tipo}</td>
            <td className="px-4 py-2 text-right">{formatMoney(f.total_debito)}</td>
            <td className="px-4 py-2 text-right">{formatMoney(f.total_credito)}</td>
          </tr>
        ))}
        {filas.length > 0 && (
          <tr className="bg-slate-50 font-semibold">
            <td className="px-4 py-2" colSpan={3}>
              Totales
            </td>
            <td className="px-4 py-2 text-right">{formatMoney(totalDebito)}</td>
            <td className="px-4 py-2 text-right">{formatMoney(totalCredito)}</td>
          </tr>
        )}
      </Table>
    </div>
  );
}
