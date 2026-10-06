import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { Badge, Button, EmptyRow, Input, Modal, PageHeader, Table } from "../../components/ui";

interface Saldo {
  cliente_id: number;
  cliente_nombre: string;
  producto_id: number;
  producto_nombre: string;
  cantidad: number;
  fianza_total: number;
}

interface Movimiento {
  id: number;
  fecha: string;
  tipo: "ENTREGA" | "DEVOLUCION";
  cantidad: number;
  cliente_nombre: string;
  producto_nombre: string;
  nota: string | null;
}

export default function ControlEnvases() {
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [open, setOpen] = useState(false);
  const [seleccion, setSeleccion] = useState<Saldo | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [reembolsar, setReembolsar] = useState(true);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const [s, m] = await Promise.all([api.envases.saldos(), api.envases.movimientos()]);
    setSaldos(s);
    setMovimientos(m as Movimiento[]);
  }

  useEffect(() => {
    cargar();
  }, []);

  function abrirDevolucion(s: Saldo) {
    setSeleccion(s);
    setCantidad(1);
    setReembolsar(true);
    setOpen(true);
  }

  async function confirmarDevolucion(e: React.FormEvent) {
    e.preventDefault();
    if (!seleccion) return;
    setGuardando(true);
    try {
      await api.envases.devolucion({
        cliente_id: seleccion.cliente_id,
        producto_id: seleccion.producto_id,
        cantidad,
        fecha: todayIso(),
        reembolsar,
      });
      setOpen(false);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  const totalEnvases = saldos.reduce((s, r) => s + r.cantidad, 0);
  const totalFianza = saldos.reduce((s, r) => s + r.fianza_total, 0);

  return (
    <div>
      <PageHeader title="Control de Envases" subtitle="Cilindros de gas/oxigeno y botellones de agua prestados a clientes (comodato)" />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:w-96">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-400">Envases en la calle</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{totalEnvases}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-400">Fianza retenida</p>
          <p className="mt-1 text-xl font-semibold text-amber-600">{formatMoney(totalFianza)}</p>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-slate-700">Saldo por cliente</h2>
      <Table columns={["Cliente", "Producto", "Cantidad", "Fianza retenida", ""]}>
        {saldos.length === 0 && <EmptyRow colSpan={5} label="No hay envases pendientes de devolucion" />}
        {saldos.map((s) => (
          <tr key={`${s.cliente_id}-${s.producto_id}`} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 font-medium text-slate-800">{s.cliente_nombre}</td>
            <td className="px-4 py-2.5">{s.producto_nombre}</td>
            <td className="px-4 py-2.5">{s.cantidad}</td>
            <td className="px-4 py-2.5">{formatMoney(s.fianza_total)}</td>
            <td className="px-4 py-2.5 text-right">
              <Button size="sm" variant="secondary" onClick={() => abrirDevolucion(s)}>
                Registrar devolucion
              </Button>
            </td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-7 text-sm font-semibold text-slate-700">Movimientos recientes</h2>
      <Table columns={["Fecha", "Tipo", "Cliente", "Producto", "Cantidad"]}>
        {movimientos.length === 0 && <EmptyRow colSpan={5} />}
        {movimientos.slice(0, 30).map((m) => (
          <tr key={m.id}>
            <td className="px-4 py-2.5">{formatDate(m.fecha)}</td>
            <td className="px-4 py-2.5">
              <Badge tone={m.tipo === "ENTREGA" ? "blue" : "green"}>{m.tipo === "ENTREGA" ? "Entrega" : "Devolucion"}</Badge>
            </td>
            <td className="px-4 py-2.5">{m.cliente_nombre}</td>
            <td className="px-4 py-2.5">{m.producto_nombre}</td>
            <td className="px-4 py-2.5">{m.cantidad}</td>
          </tr>
        ))}
      </Table>

      <Modal open={open} onClose={() => setOpen(false)} title="Registrar devolucion de envase">
        {seleccion && (
          <form onSubmit={confirmarDevolucion} className="space-y-3">
            <p className="text-sm text-slate-600">
              {seleccion.cliente_nombre} — {seleccion.producto_nombre} (tiene {seleccion.cantidad} en su poder)
            </p>
            <Input
              label="Cantidad a devolver"
              type="number"
              min={1}
              max={seleccion.cantidad}
              value={cantidad}
              onChange={(e) => setCantidad(Number(e.target.value))}
            />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={reembolsar} onChange={(e) => setReembolsar(e.target.checked)} />
              Reembolsar fianza en efectivo
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? "Guardando..." : "Confirmar"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
