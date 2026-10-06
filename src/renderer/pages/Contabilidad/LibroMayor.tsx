import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Cuenta } from "../../lib/types";
import { formatDate, formatMoney } from "../../lib/format";
import { Card, EmptyRow, PageHeader, Select, Table } from "../../components/ui";

interface Movimiento {
  fecha: string;
  numero: number;
  concepto: string;
  debito: number;
  credito: number;
  saldo: number;
}

export default function LibroMayor() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cuentaId, setCuentaId] = useState<number | "">("");
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);

  useEffect(() => {
    api.cuentas.listar().then((c) => setCuentas(c.filter((x) => x.es_movimiento)));
  }, []);

  useEffect(() => {
    if (!cuentaId) {
      setMovimientos([]);
      return;
    }
    api.asientos.libroMayor(Number(cuentaId)).then(setMovimientos as any);
  }, [cuentaId]);

  const cuenta = cuentas.find((c) => c.id === cuentaId);
  const saldoFinal = movimientos.length > 0 ? movimientos[movimientos.length - 1].saldo : 0;

  return (
    <div>
      <PageHeader title="Libro Mayor" subtitle="Movimientos y saldo acumulado por cuenta contable" />

      <Card className="mb-5 max-w-md p-4">
        <Select label="Cuenta" value={cuentaId} onChange={(e) => setCuentaId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Seleccione una cuenta...</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.codigo} - {c.nombre}
            </option>
          ))}
        </Select>
      </Card>

      {cuenta && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {cuenta.codigo} - {cuenta.nombre} ({cuenta.naturaleza === "DEUDORA" ? "Naturaleza deudora" : "Naturaleza acreedora"})
            </p>
            <p className="text-sm font-semibold text-slate-800">Saldo: {formatMoney(saldoFinal)}</p>
          </div>
          <Table columns={["Fecha", "Asiento", "Concepto", "Debito", "Credito", "Saldo"]}>
            {movimientos.length === 0 && <EmptyRow colSpan={6} label="Esta cuenta no tiene movimientos" />}
            {movimientos.map((m, i) => (
              <tr key={i}>
                <td className="px-4 py-2">{formatDate(m.fecha)}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-400">#{m.numero}</td>
                <td className="px-4 py-2">{m.concepto}</td>
                <td className="px-4 py-2 text-right">{m.debito > 0 ? formatMoney(m.debito) : ""}</td>
                <td className="px-4 py-2 text-right">{m.credito > 0 ? formatMoney(m.credito) : ""}</td>
                <td className="px-4 py-2 text-right font-medium">{formatMoney(m.saldo)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
