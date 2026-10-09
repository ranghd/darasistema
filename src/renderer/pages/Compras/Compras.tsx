import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import type { Compra, CompraLineaInput, PagoCompra, Producto, Proveedor, RelacionProductoProveedor } from "../../lib/types";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";
import { ProveedorFormModal } from "../Proveedores/componentes";
import AvisoBorrador from "../../components/AvisoBorrador";
import { useBorrador, useHabiaBorrador } from "../../lib/borrador";

interface LineaForm extends CompraLineaInput {
  key: number;
  /** El usuario escribio el precio a mano: no se reemplaza al cambiar de proveedor. */
  precioEditado: boolean;
}

let keySeq = 1;

export default function Compras() {
  const [compras, setCompras] = useState<Compra[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  // La compra a medias se guarda sola (y la ventana se vuelve a abrir al regresar).
  const habiaCompra = useHabiaBorrador("compra.lineas", (v) => Array.isArray(v) && v.length > 0);
  const [open, setOpen] = useState(habiaCompra);
  const [avisoRecuperada, setAvisoRecuperada] = useState(habiaCompra);
  useEffect(() => {
    if (!habiaCompra) setFecha(todayIso());
  }, []);
  const [fecha, setFecha] = useBorrador("compra.fecha", todayIso());
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [relaciones, setRelaciones] = useState<RelacionProductoProveedor[]>([]);
  const [proveedorId, setProveedorId] = useBorrador<number | "">("compra.proveedor", "");
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [condicionPago, setCondicionPago] = useBorrador<"CONTADO" | "CREDITO">("compra.condicion", "CONTADO");
  const [lineas, setLineas] = useBorrador<LineaForm[]>("compra.lineas", []);
  keySeq = Math.max(keySeq, ...lineas.map((l) => l.key + 1));
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const [pagoCompra, setPagoCompra] = useState<Compra | null>(null);
  const [montoPago, setMontoPago] = useState(0);
  const [metodoPago, setMetodoPago] = useState<PagoCompra["metodo"]>("EFECTIVO");
  const [errorPago, setErrorPago] = useState("");
  const [guardandoPago, setGuardandoPago] = useState(false);

  async function cargar() {
    const [c, p, provs, rel] = await Promise.all([api.compras.listar(), api.productos.listar(), api.proveedores.listar(), api.proveedores.relaciones()]);
    setCompras(c);
    setProductos(p);
    setProveedores(provs.filter((x) => x.activo));
    setRelaciones(rel);
  }

  useEffect(() => {
    cargar();
  }, []);

  function limpiarCompra() {
    setFecha(todayIso());
    setProveedorId("");
    setCondicionPago("CONTADO");
    setLineas([]);
    setAvisoRecuperada(false);
  }

  // Si habia una compra a medias, "+ Nueva Compra" la retoma en vez de borrarla.
  function abrirNueva() {
    if (lineas.length === 0) limpiarCompra();
    setError("");
    setOpen(true);
  }

  // Cancelar si descarta la compra; salir de la pantalla no.
  function cancelarCompra() {
    limpiarCompra();
    setOpen(false);
  }

  function relacion(productoId: number, provId: number | "") {
    return provId ? relaciones.find((r) => r.producto_id === productoId && r.proveedor_id === provId) : undefined;
  }

  // Precio sugerido: lo ultimo que se le pago a ese proveedor por ese producto, o lo cotizado, o el costo actual.
  function precioSugerido(productoId: number, provId: number | ""): number {
    const r = relacion(productoId, provId);
    return r?.ultimo_precio ?? r?.precio_referencia ?? productos.find((x) => x.id === productoId)?.costo_contenido ?? 0;
  }

  function cambiarProveedor(nuevo: number | "", lineasActuales = lineas) {
    setProveedorId(nuevo);
    setLineas(lineasActuales.map((l) => (l.precioEditado ? l : { ...l, costo_unitario: precioSugerido(l.producto_id, nuevo) })));
  }

  function agregarLinea() {
    if (productos.length === 0) return;
    const p = productos[0];
    setLineas([...lineas, { key: keySeq++, producto_id: p.id, cantidad: 1, costo_unitario: precioSugerido(p.id, proveedorId), precioEditado: false }]);
  }

  function actualizarLinea(key: number, cambios: Partial<LineaForm>) {
    setLineas(lineas.map((l) => (l.key === key ? { ...l, ...cambios } : l)));
  }

  function cambiarProducto(key: number, productoId: number) {
    const p = productos.find((x) => x.id === productoId);
    if (!p) return;
    actualizarLinea(key, { producto_id: p.id, costo_unitario: precioSugerido(p.id, proveedorId), precioEditado: false });
  }

  const total = lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0);

  async function guardar() {
    setError("");
    if (!proveedorId) return setError("Selecciona el proveedor (o crea uno nuevo)");
    if (lineas.length === 0) return setError("Agregue al menos un producto");
    setGuardando(true);
    try {
      await api.compras.crear({
        fecha,
        proveedor_id: proveedorId,
        condicion_pago: condicionPago,
        lineas: lineas.map(({ key, precioEditado, ...rest }) => rest),
      });
      limpiarCompra();
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
            <td className="px-4 py-2.5 font-medium text-slate-800">
              {c.proveedor_id ? (
                <Link to={`/proveedores/${c.proveedor_id}`} className="hover:text-brand-700 hover:underline">
                  {c.proveedor}
                </Link>
              ) : (
                c.proveedor
              )}
            </td>
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
          {avisoRecuperada && lineas.length > 0 && (
            <AvisoBorrador
              texto={`Se recupero la compra que estabas registrando (${lineas.length} producto${lineas.length === 1 ? "" : "s"}).`}
              onOcultar={() => setAvisoRecuperada(false)}
              onDescartar={limpiarCompra}
            />
          )}
          <div className="grid grid-cols-3 gap-3">
            <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <div>
              <Select label="Proveedor" value={proveedorId} onChange={(e) => cambiarProveedor(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Selecciona un proveedor...</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </Select>
              <button type="button" className="mt-1 text-xs font-medium text-brand-600 hover:underline" onClick={() => setNuevoProveedor(true)}>
                + Agregar nuevo proveedor
              </button>
            </div>
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

          {lineas.length > 0 && (
            <div className="grid grid-cols-12 gap-2 px-3 text-xs font-semibold uppercase text-slate-400">
              <span className="col-span-4">Producto</span>
              <span className="col-span-2">Cantidad</span>
              <span className="col-span-3">Precio de compra</span>
              <span className="col-span-3" />
            </div>
          )}
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
                    <Input type="number" step="0.01" value={l.costo_unitario} onChange={(e) => actualizarLinea(l.key, { costo_unitario: Number(e.target.value), precioEditado: true })} />
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
                <div className="mt-2 flex flex-wrap items-start justify-between gap-2 text-xs">
                  <div className="space-y-1">
                    <ReferenciaPrecio
                      relacion={relacion(l.producto_id, proveedorId)}
                      nombreProveedor={proveedores.find((x) => x.id === proveedorId)?.nombre}
                      precioActual={l.costo_unitario}
                      onUsar={(precio) => actualizarLinea(l.key, { costo_unitario: precio, precioEditado: false })}
                    />
                    <OtrosProveedores
                      relaciones={relaciones.filter((r) => r.producto_id === l.producto_id && r.proveedor_id !== proveedorId && r.proveedor_activo && (r.ultimo_precio ?? r.precio_referencia) !== null)}
                      onElegir={(provId) => cambiarProveedor(provId, lineas.map((x) => (x.key === l.key ? { ...x, precioEditado: false } : x)))}
                    />
                  </div>
                  <span className="text-slate-500">Subtotal: {formatMoney(l.cantidad * l.costo_unitario)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={cancelarCompra}>
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
      <ProveedorFormModal
        open={nuevoProveedor}
        onClose={() => setNuevoProveedor(false)}
        onGuardado={(p) => {
          setProveedores((prev) => [...prev, p].sort((a, b) => a.nombre.localeCompare(b.nombre)));
          cambiarProveedor(p.id);
        }}
      />
    </div>
  );
}

// Ultimo precio pagado a este proveedor por este producto (referencia; se puede cambiar).
function ReferenciaPrecio({
  relacion,
  nombreProveedor,
  precioActual,
  onUsar,
}: {
  relacion?: RelacionProductoProveedor;
  nombreProveedor?: string;
  precioActual: number;
  onUsar: (precio: number) => void;
}) {
  if (!nombreProveedor) return <p className="text-slate-400">Selecciona el proveedor para ver su ultimo precio.</p>;
  const ultimo = relacion?.ultimo_precio;
  if (ultimo === null || ultimo === undefined) {
    return <p className="text-slate-500">Primera vez que le compras este producto a {nombreProveedor}: quedaran asociados al guardar.</p>;
  }
  return (
    <p className="text-slate-600">
      Ultimo precio con {nombreProveedor}: <b>{formatMoney(ultimo)}</b> ({formatDate(relacion?.ultima_fecha)})
      {Math.abs(ultimo - precioActual) > 0.004 && (
        <button type="button" className="ml-2 text-brand-600 hover:underline" onClick={() => onUsar(ultimo)}>
          usar ese precio
        </button>
      )}
    </p>
  );
}

// Otros proveedores que venden el producto, con su ultimo precio. Al elegir uno, la compra pasa a ese proveedor.
function OtrosProveedores({ relaciones, onElegir }: { relaciones: RelacionProductoProveedor[]; onElegir: (proveedorId: number) => void }) {
  if (relaciones.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-slate-400">Otros proveedores:</span>
      {relaciones.map((r) => (
        <button
          key={r.proveedor_id}
          type="button"
          title="Comprar a este proveedor con su ultimo precio"
          className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 hover:border-brand-400 hover:text-brand-700"
          onClick={() => onElegir(r.proveedor_id)}
        >
          {r.proveedor_nombre} — {formatMoney(r.ultimo_precio ?? r.precio_referencia)}
        </button>
      ))}
    </div>
  );
}
