import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { ComprobanteVarios, Cuenta, TipoComprobanteVarios } from "../../lib/types";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { Badge, Button, Card, EmptyRow, Input, PageHeader, Select, Table } from "../../components/ui";

const TABS: { tipo: TipoComprobanteVarios; label: string; descripcion: string }[] = [
  { tipo: "B11", label: "B11 - Registro de Ingresos", descripcion: "Para consolidar muchas ventas pequenas del dia en un solo comprobante, en vez de un NCF por cada una." },
  { tipo: "B12", label: "B12 - Gastos Menores", descripcion: "Para registrar gastos pagados en efectivo que no tienen factura formal de un proveedor (ej. un mandado, una reparacion pequena)." },
  { tipo: "B16", label: "B16 - Pago al Exterior", descripcion: "Para pagos realizados a proveedores o personas fuera del pais." },
];

export default function Comprobantes() {
  const [tab, setTab] = useState<TipoComprobanteVarios>("B11");
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [historial, setHistorial] = useState<ComprobanteVarios[]>([]);
  const [fecha, setFecha] = useState(todayIso());
  const [concepto, setConcepto] = useState("");
  const [contraparte, setContraparte] = useState("");
  const [monto, setMonto] = useState(0);
  const [aplicaItbis, setAplicaItbis] = useState(false);
  const [cuentaId, setCuentaId] = useState<number | "">("");
  const [metodo, setMetodo] = useState<"CAJA" | "BANCO">("CAJA");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function cargar() {
    const [c, h] = await Promise.all([api.cuentas.listar(), api.comprobantes.listar()]);
    setCuentas(c);
    setHistorial(h as ComprobanteVarios[]);
  }

  useEffect(() => {
    cargar();
  }, []);

  const tipoCuenta = tab === "B11" ? "INGRESOS" : "GASTOS";
  const cuentasFiltradas = cuentas.filter((c) => c.tipo === tipoCuenta && c.es_movimiento);

  function cambiarTab(t: TipoComprobanteVarios) {
    setTab(t);
    setConcepto("");
    setContraparte("");
    setMonto(0);
    setAplicaItbis(false);
    setCuentaId("");
    setError("");
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!cuentaId) return setError("Seleccione una cuenta contable");
    if (monto <= 0) return setError("El monto debe ser mayor a cero");
    setGuardando(true);
    try {
      await api.comprobantes.registrar({ tipo: tab, fecha, concepto: concepto || TABS.find((t) => t.tipo === tab)!.label, contraparte: contraparte || undefined, monto, aplicaItbis, cuenta_id: cuentaId, metodo });
      setConcepto("");
      setContraparte("");
      setMonto(0);
      await cargar();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo registrar el comprobante");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <PageHeader title="Otros Comprobantes" subtitle="Registro de Ingresos (B11), Gastos Menores (B12) y Pagos al Exterior (B16)" />

      <div className="mb-4 flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.tipo}
            onClick={() => cambiarTab(t.tipo)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${tab === t.tipo ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 text-sm text-slate-500">{TABS.find((t) => t.tipo === tab)?.descripcion}</p>
          <form onSubmit={registrar} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              <Input label="Monto" type="number" step="0.01" value={monto} onChange={(e) => setMonto(Number(e.target.value))} />
            </div>
            <Input label="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder={tab === "B11" ? "Ej. Ventas menores del dia" : tab === "B12" ? "Ej. Compra de materiales de limpieza" : "Ej. Pago a proveedor en el exterior"} />
            <Input
              label={tab === "B11" ? "Fuente (opcional)" : tab === "B12" ? "Pagado a (opcional)" : "Proveedor en el exterior"}
              value={contraparte}
              onChange={(e) => setContraparte(e.target.value)}
            />
            <Select label={tab === "B11" ? "Cuenta de ingreso" : "Cuenta de gasto"} value={cuentaId} onChange={(e) => setCuentaId(Number(e.target.value))}>
              <option value="">Seleccione...</option>
              {cuentasFiltradas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} - {c.nombre}
                </option>
              ))}
            </Select>
            <Select label="Pagado con / Depositado en" value={metodo} onChange={(e) => setMetodo(e.target.value as any)}>
              <option value="CAJA">Caja</option>
              <option value="BANCO">Banco</option>
            </Select>
            {tab === "B11" && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={aplicaItbis} onChange={(e) => setAplicaItbis(e.target.checked)} />
                Aplica ITBIS sobre este monto
              </label>
            )}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={guardando} className="w-full">
              {guardando ? "Guardando..." : "Registrar"}
            </Button>
          </form>
        </Card>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Historial</h2>
          <Table columns={["NCF", "Fecha", "Concepto", "Monto", "Metodo"]}>
            {historial.length === 0 && <EmptyRow colSpan={5} />}
            {historial.map((h) => (
              <tr key={h.id}>
                <td className="px-4 py-2">
                  <Badge tone="blue">{h.ncf}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{formatDate(h.fecha)}</td>
                <td className="px-4 py-2">{h.concepto}</td>
                <td className="px-4 py-2 text-right">{formatMoney(h.total)}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{h.metodo === "CAJA" ? "Caja" : "Banco"}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </div>
  );
}
