import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { Card, PageHeader } from "../../components/ui";

interface Fila {
  codigo: string;
  nombre: string;
  saldo: number;
}

interface Balance {
  activo: Fila[];
  pasivo: Fila[];
  patrimonio: Fila[];
  utilidadDelPeriodo: number;
  totalActivo: number;
  totalPasivo: number;
  totalPatrimonio: number;
}

export default function BalanceGeneral() {
  const [data, setData] = useState<Balance | null>(null);

  useEffect(() => {
    api.reportes.balanceGeneral().then(setData as any);
  }, []);

  if (!data) return <p className="text-sm text-slate-400">Cargando...</p>;

  const cuadrado = Math.abs(data.totalActivo - (data.totalPasivo + data.totalPatrimonio)) < 0.5;

  return (
    <div>
      <PageHeader title="Balance General" subtitle="Activo = Pasivo + Patrimonio, a la fecha de hoy" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Activo</h2>
          <List filas={data.activo} />
          <Total label="Total Activo" value={data.totalActivo} />
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Pasivo</h2>
            <List filas={data.pasivo} />
            <Total label="Total Pasivo" value={data.totalPasivo} />
          </Card>

          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Patrimonio</h2>
            <List filas={data.patrimonio} />
            <div className="flex justify-between py-1 text-sm text-slate-600">
              <span>Utilidad del periodo</span>
              <span>{formatMoney(data.utilidadDelPeriodo)}</span>
            </div>
            <Total label="Total Patrimonio" value={data.totalPatrimonio} />
          </Card>
        </div>
      </div>

      <p className={`mt-5 text-sm font-medium ${cuadrado ? "text-emerald-600" : "text-red-600"}`}>
        {cuadrado ? "El balance cuadra correctamente." : "Atencion: el balance no cuadra."}
      </p>
    </div>
  );
}

function List({ filas }: { filas: Fila[] }) {
  if (filas.length === 0) return <p className="text-sm text-slate-400">Sin movimientos</p>;
  return (
    <div className="space-y-1">
      {filas.map((f) => (
        <div key={f.codigo} className="flex justify-between text-sm text-slate-600">
          <span>{f.nombre}</span>
          <span>{formatMoney(f.saldo)}</span>
        </div>
      ))}
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold text-slate-900">
      <span>{label}</span>
      <span>{formatMoney(value)}</span>
    </div>
  );
}
