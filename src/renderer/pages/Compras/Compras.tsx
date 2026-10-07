import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Compra, CompraLineaInput, PagoCompra, Producto } from "../../lib/types";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

interface LineaForm extends CompraLineaInput {
  key: number;
}

let keySeq = 1;

export default function Compras() {
  const [compras, setCompras] = useState<Compra[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [open, setOpen] = useState(false);
  const [fecha, setFecha] = useState(todayIso());
  const [proveedor, setProveedor] = useState("");
  const [condicionPago, setCondicionPago] = useState<"CONTADO" | "CREDITO">("CONTADO");
  const [lineas, setLineas] = useState<LineaForm[]>([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const [pagoCompra, setPagoCompra] = useState<Compra | null>(null);
  const [montoPago, setMontoPago] = useState(0);
  const [metodoPago, setMetodoPago] = useState<PagoCompra["metodo"]>("EFECTIVO");
  const [errorPago, setErrorPago] = useState("");
  const [guardandoPago, setGuardandoPago] = useState(false);

  async function cargar() {
    const [c, p] = await Promise.all([api.compras.listar(), api.productos.listar()]);
    setCompras(c);
    setProductos(p);
  }

  useEffect(() => {
    cargar();
  }, []);

  function abrirNueva() {
    setFecha(todayIso());
    setProveedor("");
    setCondicionPago("CONTADO");
    setLineas([]);
    setError("");
    setOpen(true);
  }

  function agregarLinea() {
    if (productos.length === 0) return;
    const p = productos[0];
    setLineas([...lineas, { key: keySeq++, producto_id: p.id, cantidad: 1, costo_unitario: p.costo_contenido, actualizarCosto: false }]);
  }

  function actualizarLinea(key: number, cambios: Partial<LineaForm>) {
    setLineas(lineas.map((l) => (l.key === key ? { ...l, ...cambios } : l)));
  }

  function cambiarProducto(key: number, productoId: number) {
    const p = productos.find((x) => x.id === productoId);
    if (!p) return;
    actualizarLinea(key, { producto_id: p.id, costo_unitario: p.costo_contenido });
  }

  const total = lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0);

  async function guardar() {
    setError("");
    if (!proveedor.trim()) return setError("El proveedor es obligatorio");
    if (lineas.length === 0) return setError("Agregue al menos un producto");
    setGuardando(true);
    try {
      await api.compras.crear({
        fecha,
        proveedor: proveedor.trim(),
        condicion_pago: condicionPago,
        lineas: lineas.map(({ key, ...rest }) => rest),
      });
      setOpen(false);
      await cargar();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo registrar la compra");
    } finally {
      setGuardando(false);
    }
  }

  function abrirPago(c: Compra) {
    setPagoCompra(c);
    setMontoPago(Math.round((c.total - (c.pagado ?? 0)) * 100) / 100);
    setMetodoPago("EFECTIVO");
    setErrorPago("");
  }

  async function confirmarPago(e: React.FormEvent) {
    e.preventDefault();
    if (!pagoCompra) return;
    setGuardandoPago(true);
    setErrorPago("");
    try {
      await api.pagosCompra.crear({ compra_id: pagoCompra.id, fecha: todayIso(), monto: montoPago, metodo: metodoPago });
      setPagoCompra(null);
      await cargar();
    } catch (err: any) {
      setErrorPago(err?.message ?? "No se pudo registrar el pago");
    } finally {
      setGuardandoPago(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Compras"
        subtitle="Entrada de inventario: mercancia recibida de proveedores"
        actions={<Button onClick={abrirNueva}>+ Nueva Compra</Button>}
      />

      <Table columns={["Num.", "Fecha", "Proveedor", "Condicion", "Total", "Estado", ""]}>
        {compras.length === 0 && <EmptyRow colSpan={7} />}
        {compras.map((c) => (
          <tr key={c.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 text-slate-500">{c.numero}</td>
            <td className="px-4 py-2.5">{formatDate(c.fecha)}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">{c.proveedor}</td>
            <td className="px-4 py-2.5">{c.condicion_pago === "CONTADO" ? "Contado" : "Credito"}</td>
            <td className="px-4 py-2.5">{formatMoney(c.total)}</td>
            <td className="px-4 py-2.5">
              <Badge tone={c.estado === "PAGADA" ? "green" : "amber"}>{c.estado}</Badge>
            </td>
            <td className="px-4 py-2.5 text-right">
              {c.estado === "PENDIENTE" && (
                <Button size="sm" variant="secondary" onClick={() => abrirPago(c)}>
                  Registrar pago
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={open} onClose={() => setOpen(false)} title="Nueva Compra" width="max-w-3xl">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <Input label="Proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Nombre del proveedor" />
            <Select label="Condicion de pago" value={condicionPago} onChange={(e) => setCondicionPago(e.target.value as any)}>
              <option value="CONTADO">Contado</option>
              <option value="CREDITO">Credito</option>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Productos recibidos</h2>
            <Button size="sm" variant="secondary" type="button" onClick={agregarLinea}>
              + Agregar producto
            </Button>
          </div>

          {lineas.length === 0 && <p className="py-4 text-center text-sm text-slate-400">Agregue los productos que recibio del proveedor</p>}

          <div className="space-y-2">
            {lineas.map((l) => (
              <div key={l.key} className="rounded-lg border border-slate-200 p-3">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <Select value={l.producto_id} onChange={(e) => cambiarProducto(l.key, Number(e.target.value))}>
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Input type="number" min={0.01} step="0.01" value={l.cantidad} onChange={(e) => actualizarLinea(l.key, { cantidad: Number(e.target.value) })} />
                  </div>
                  <div className="col-span-3">
                    <Input type="number" step="0.01" value={l.costo_unitario} onChange={(e) => actualizarLinea(l.key, { costo_unitario: Number(e.target.value) })} />
                  </div>
                  <div className="col-span-2 text-xs leading-tight text-slate-500">
                    {(() => {
                      const prod = productos.find((x) => x.id === l.producto_id);
                      if (!prod) return null;
                      const total = prod.existencia + l.cantidad;
                      const promedio = prod.existencia > 0 && total > 0 ? (prod.existencia * prod.costo_contenido + l.cantidad * l.costo_unitario) / total : l.costo_unitario;
                      return (
                        <>
                          Costo promedio
                          <br />
                          <span className="font-medium text-slate-700">{formatMoney(promedio)}</span>
                        </>
                      );
                    })()}
                  </div>
                  <div className="col-span-1 text-right">
                    <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => setLineas(lineas.filter((x) => x.key !== l.key))}>
                      Quitar
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-right text-xs text-slate-500">Subtotal: {formatMoney(l.cantidad * l.costo_unitario)}</div>
              </div>
            ))}
          </div>

          <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando..." : "Registrar Compra"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!pagoCompra} onClose={() => setPagoCompra(null)} title="Registrar pago a proveedor">
        {pagoCompra && (
          <form onSubmit={confirmarPago} className="space-y-3">
            <p className="text-sm text-slate-600">
              Compra #{pagoCompra.numero} - {pagoCompra.proveedor}
            </p>
            <Input
              label="Monto"
              type="number"
              step="0.01"
              max={pagoCompra.total - (pagoCompra.pagado ?? 0)}
              value={montoPago}
              onChange={(e) => setMontoPago(Number(e.target.value))}
            />
            <Select label="Metodo de pago" value={metodoPago} onChange={(e) => setMetodoPago(e.target.value as any)}>
              <option value="EFECTIVO">Efectivo</option>
              <option value="TRANSFERENCIA">Transferencia</option>
              <option value="TARJETA">Tarjeta</option>
              <option value="CHEQUE">Cheque</option>
            </Select>
            {errorPago && <p className="text-sm text-red-600">{errorPago}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setPagoCompra(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardandoPago}>
                {guardandoPago ? "Guardando..." : "Registrar"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
