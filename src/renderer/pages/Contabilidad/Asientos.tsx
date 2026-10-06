import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { AsientoConLineas, Cuenta } from "../../lib/types";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { Badge, Button, Card, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

interface LineaManual {
  key: number;
  cuenta_id: number | "";
  debito: number;
  credito: number;
  descripcion: string;
}

let keySeq = 1;

export default function Asientos() {
  const [asientos, setAsientos] = useState<AsientoConLineas[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [open, setOpen] = useState(false);
  const [fecha, setFecha] = useState(todayIso());
  const [concepto, setConcepto] = useState("");
  const [lineas, setLineas] = useState<LineaManual[]>([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const [a, c] = await Promise.all([api.asientos.listar(), api.cuentas.listar()]);
    setAsientos(a as AsientoConLineas[]);
    setCuentas((c as Cuenta[]).filter((x) => x.es_movimiento));
  }

  useEffect(() => {
    cargar();
  }, []);

  function abrirNuevo() {
    setFecha(todayIso());
    setConcepto("");
    setLineas([
      { key: keySeq++, cuenta_id: "", debito: 0, credito: 0, descripcion: "" },
      { key: keySeq++, cuenta_id: "", debito: 0, credito: 0, descripcion: "" },
    ]);
    setError("");
    setOpen(true);
  }

  function actualizar(key: number, cambios: Partial<LineaManual>) {
    setLineas(lineas.map((l) => (l.key === key ? { ...l, ...cambios } : l)));
  }

  const totalDebito = lineas.reduce((s, l) => s + (Number(l.debito) || 0), 0);
  const totalCredito = lineas.reduce((s, l) => s + (Number(l.credito) || 0), 0);
  const descuadrado = Math.abs(totalDebito - totalCredito) > 0.005;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (descuadrado) {
      setError("El asiento no cuadra: debitos y creditos deben ser iguales");
      return;
    }
    if (lineas.some((l) => !l.cuenta_id)) {
      setError("Seleccione una cuenta en cada linea");
      return;
    }
    setGuardando(true);
    try {
      await api.asientos.crear({
        fecha,
        concepto,
        lineas: lineas.map((l) => ({ cuenta_id: Number(l.cuenta_id), debito: Number(l.debito) || 0, credito: Number(l.credito) || 0, descripcion: l.descripcion })),
      });
      setOpen(false);
      await cargar();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo guardar el asiento");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <PageHeader title="Libro Diario" subtitle="Asientos contables de partida doble (manuales y generados por facturacion/cobros)" actions={<Button onClick={abrirNuevo}>+ Nuevo Asiento Manual</Button>} />

      <div className="space-y-4">
        {asientos.length === 0 && <p className="text-sm text-slate-400">Aun no hay asientos registrados.</p>}
        {asientos.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <span className="mr-2 font-mono text-xs text-slate-400">#{a.numero}</span>
                <span className="text-sm font-medium text-slate-800">{a.concepto}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Badge tone={a.origen === "MANUAL" ? "slate" : a.origen === "FACTURA" ? "blue" : a.origen === "COBRO" ? "green" : "amber"}>{a.origen}</Badge>
                {formatDate(a.fecha)}
              </div>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {a.lineas.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2 text-xs text-slate-400">{l.cuenta_codigo}</td>
                    <td className="py-1.5 pr-2 text-slate-700">{l.cuenta_nombre}</td>
                    <td className="py-1.5 pr-2 text-right text-slate-600">{l.debito > 0 ? formatMoney(l.debito) : ""}</td>
                    <td className="py-1.5 text-right text-slate-600">{l.credito > 0 ? formatMoney(l.credito) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo Asiento Manual" width="max-w-3xl">
        <form onSubmit={guardar} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <Input label="Concepto" required value={concepto} onChange={(e) => setConcepto(e.target.value)} />
          </div>

          <Table columns={["Cuenta", "Descripcion", "Debito", "Credito", ""]}>
            {lineas.map((l) => (
              <tr key={l.key}>
                <td className="px-2 py-1.5">
                  <Select value={l.cuenta_id} onChange={(e) => actualizar(l.key, { cuenta_id: Number(e.target.value) })}>
                    <option value="">Seleccione...</option>
                    {cuentas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} - {c.nombre}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-2 py-1.5">
                  <Input value={l.descripcion} onChange={(e) => actualizar(l.key, { descripcion: e.target.value })} />
                </td>
                <td className="px-2 py-1.5">
                  <Input type="number" step="0.01" value={l.debito} onChange={(e) => actualizar(l.key, { debito: Number(e.target.value), credito: 0 })} />
                </td>
                <td className="px-2 py-1.5">
                  <Input type="number" step="0.01" value={l.credito} onChange={(e) => actualizar(l.key, { credito: Number(e.target.value), debito: 0 })} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => setLineas(lineas.filter((x) => x.key !== l.key))}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </Table>

          <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setLineas([...lineas, { key: keySeq++, cuenta_id: "", debito: 0, credito: 0, descripcion: "" }])}>
            + Agregar linea
          </button>

          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className={descuadrado ? "font-semibold text-red-600" : "text-slate-600"}>
              Debitos {formatMoney(totalDebito)} · Creditos {formatMoney(totalCredito)}
            </span>
            {!descuadrado && totalDebito > 0 && <span className="font-medium text-emerald-600">Cuadrado</span>}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar Asiento"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
