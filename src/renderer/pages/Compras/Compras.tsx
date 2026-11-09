import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import type { Compra, CompraLineaInput, CompraPiezaLinea, MercanciaResumen, PagoCompra, Producto, Proveedor, RelacionProductoProveedor } from "../../lib/types";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";
import { ProveedorFormModal } from "../Proveedores/componentes";
import AvisoBorrador from "../../components/AvisoBorrador";
import { useBorrador, useHabiaBorrador } from "../../lib/borrador";
import PagoSuplidorModal, { type DocumentoPorPagar } from "../../components/PagoSuplidor";
import { useAuth } from "../../lib/auth";
import { useCaja } from "../../lib/caja";
import { esFritura, esVariantCaja } from "../../lib/variant";

interface LineaForm extends CompraLineaInput {
  key: number;
  /** El usuario escribio el precio a mano: no se reemplaza al cambiar de proveedor. */
  precioEditado: boolean;
}

// Dara Frituras: una pieza comprada (pierna de salami, libra de longaniza...) que entra al Control de piezas.
interface PiezaForm extends CompraPiezaLinea {
  key: number;
}

// "pierna" -> "piernas", "libra" -> "libras", "flan" -> "flanes"
const plural = (palabra: string, n: number) => (n === 1 ? palabra : /[aeiou]$/i.test(palabra) ? `${palabra}s` : `${palabra}es`);

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
  const [ncf, setNcf] = useBorrador("compra.ncf", "");
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [condicionPago, setCondicionPago] = useBorrador<"CONTADO" | "CREDITO">("compra.condicion", "CONTADO");
  const [lineas, setLineas] = useBorrador<LineaForm[]>("compra.lineas", []);
  const [piezas, setPiezas] = useBorrador<PiezaForm[]>("compra.piezas", []);
  keySeq = Math.max(keySeq, ...lineas.map((l) => l.key + 1), ...piezas.map((l) => l.key + 1));
  const [mercancias, setMercancias] = useState<MercanciaResumen[]>([]);
  // En la caja, la compra de contado sale del efectivo de la jornada (si no, del dinero del negocio).
  const { usuario } = useAuth();
  const { sesion, recargar: recargarCaja } = useCaja();
  const [deCaja, setDeCaja] = useState(esVariantCaja);
  // Por ahora solo en Dara Frituras (en Gas Damian la compra no toca el efectivo de la caja).
  const sesionCaja = esFritura ? sesion : null;
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const [pagoCompra, setPagoCompra] = useState<DocumentoPorPagar | null>(null);

  async function cargar() {
    const [c, p, provs, rel, merc] = await Promise.all([
      api.compras.listar(),
      api.productos.listar(),
      api.proveedores.listar(),
      api.proveedores.relaciones(),
      esFritura ? api.piezas.resumen() : Promise.resolve([] as MercanciaResumen[]),
    ]);
    setCompras(c);
    setMercancias(merc);
    const activos = p.filter((x) => x.activo);
    setProductos(activos);
    setLineas((prev) => prev.filter((l) => activos.some((x) => x.id === l.producto_id)));
    setProveedores(provs.filter((x) => x.activo));
    setRelaciones(rel);
  }

  useEffect(() => {
    cargar().then(() => {
      // Desde Control de piezas: "Registrar compra" abre la compra con esa mercancia.
      const pieza = Number(params.get("pieza"));
      if (!pieza) return;
      setParams({}, { replace: true });
      api.piezas.resumen().then((lista) => {
        const m = lista.find((x) => x.id === pieza);
        if (!m) return;
        setError("");
        setOpen(true);
        setPiezas((prev) => (prev.some((x) => x.mercancia_id === m.id) ? prev : [...prev, nuevaPieza(m)]));
      });
    });
  }, []);

  function nuevaPieza(m: MercanciaResumen): PiezaForm {
    return { key: keySeq++, mercancia_id: m.id, cantidad: 1, costo_unitario: 0, ganancia_pct: m.ganancia_pct };
  }

  function actualizarPieza(key: number, cambios: Partial<PiezaForm>) {
    setPiezas(piezas.map((l) => (l.key === key ? { ...l, ...cambios } : l)));
  }

  function limpiarCompra() {
    setFecha(todayIso());
    setProveedorId("");
    setNcf("");
    setCondicionPago("CONTADO");
    setLineas([]);
    setPiezas([]);
    setDeCaja(esVariantCaja);
    setAvisoRecuperada(false);
  }

  // Si habia una compra a medias, "+ Nueva Compra" la retoma en vez de borrarla.
  function abrirNueva() {
    if (lineas.length === 0 && piezas.length === 0) limpiarCompra();
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

  const total = lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0) + piezas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0);
  const pagaCaja = !!sesionCaja && deCaja && condicionPago === "CONTADO";

  async function guardar() {
    setError("");
    if (!proveedorId) return setError("Selecciona el proveedor (o crea uno nuevo)");
    if (lineas.length === 0 && piezas.length === 0) return setError(esFritura ? "Agregue al menos un producto o una pieza" : "Agregue al menos un producto");
    for (const pz of piezas) {
      const m = mercancias.find((x) => x.id === pz.mercancia_id);
      if (!m) return setError("Elige la mercancia de cada pieza");
      if (!Number.isInteger(pz.cantidad) || pz.cantidad < 1) return setError(`Escribe cuantas piezas de ${m.nombre} compraste (numero entero)`);
      if (!(pz.costo_unitario > 0)) return setError(`Escribe cuanto costo cada ${m.pieza} de ${m.nombre}`);
      if (!(pz.ganancia_pct >= 0)) return setError(`Escribe cuanto le quieres ganar a ${m.nombre} (%)`);
    }
    if (pagaCaja && sesionCaja && total > sesionCaja.resumen.efectivo_esperado + 0.005)
      return setError(`En la caja deberia haber ${formatMoney(sesionCaja.resumen.efectivo_esperado)}: no alcanza para pagar ${formatMoney(total)}`);
    setGuardando(true);
    try {
      await api.compras.crear({
        fecha,
        proveedor_id: proveedorId,
        ncf,
        condicion_pago: condicionPago,
        lineas: lineas.map(({ key, precioEditado, ...rest }) => rest),
        piezas: piezas.map(({ key, ...rest }) => rest),
        caja_sesion_id: pagaCaja ? sesionCaja!.id : null,
        autor: { id: usuario?.id ?? null, nombre: usuario?.nombre ?? "", rol: usuario?.rol },
      });
      if (pagaCaja) recargarCaja();
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
    setPagoCompra({ origen: "COMPRA", id: c.id, numero: c.numero, suplidor: c.proveedor, ncf: c.ncf ?? null, saldo: Math.round((c.total - (c.pagado ?? 0)) * 100) / 100 });
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
          {avisoRecuperada && lineas.length + piezas.length > 0 && (
            <AvisoBorrador
              texto={`Se recupero la compra que estabas registrando (${lineas.length + piezas.length} linea${lineas.length + piezas.length === 1 ? "" : "s"}).`}
              onOcultar={() => setAvisoRecuperada(false)}
              onDescartar={limpiarCompra}
            />
          )}
          <div className="grid grid-cols-4 gap-3">
            <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <Input label="NCF de la factura (opcional)" value={ncf} onChange={(e) => setNcf(e.target.value.toUpperCase())} placeholder="B0100000123" />
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

          {esFritura && (
            <PiezasCompra
              piezas={piezas}
              mercancias={mercancias}
              onAgregar={() => mercancias.length > 0 && setPiezas([...piezas, nuevaPieza(mercancias[0])])}
              onCambiar={actualizarPieza}
              onQuitar={(key) => setPiezas(piezas.filter((x) => x.key !== key))}
            />
          )}

          <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>

          {sesionCaja && condicionPago === "CONTADO" && (
            <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={deCaja} onChange={(e) => setDeCaja(e.target.checked)} />
              <span>
                Se pago con el dinero de la caja
                <span className="block text-xs text-slate-500">
                  {deCaja ? `Sale del efectivo de esta caja (deberia haber ${formatMoney(sesionCaja.resumen.efectivo_esperado)}).` : "No toca el efectivo de la caja: se pago con otro dinero."}
                </span>
              </span>
            </label>
          )}

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

      <PagoSuplidorModal doc={pagoCompra} onClose={() => setPagoCompra(null)} onPagado={cargar} />
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

// Dara Frituras: piezas de la compra (salami, longaniza...). Cada una entra al Control de piezas con su costo y
// lo que se le quiere ganar; las ventas de sus productos se le van sumando.
function PiezasCompra({
  piezas,
  mercancias,
  onAgregar,
  onCambiar,
  onQuitar,
}: {
  piezas: PiezaForm[];
  mercancias: MercanciaResumen[];
  onAgregar: () => void;
  onCambiar: (key: number, cambios: Partial<PiezaForm>) => void;
  onQuitar: (key: number) => void;
}) {
  return (
    <div className="space-y-2 border-t border-slate-200 pt-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Piezas (Control de piezas)</h2>
          <p className="text-xs text-slate-500">Lo que se compra entero y se vende por porciones: pierna de salami, longaniza, queso...</p>
        </div>
        {mercancias.length > 0 && (
          <Button size="sm" variant="secondary" type="button" onClick={onAgregar}>
            + Agregar pieza
          </Button>
        )}
      </div>
      {mercancias.length === 0 && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Para comprar por piezas, primero crea la mercancia en{" "}
          <Link to="/piezas" className="font-medium text-brand-600 hover:underline">
            Control de piezas
          </Link>
          .
        </p>
      )}
      {piezas.map((l) => {
        const m = mercancias.find((x) => x.id === l.mercancia_id);
        const subtotal = l.cantidad * l.costo_unitario;
        return (
          <div key={l.key} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
            <div className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-4">
                <Select
                  label="Mercancia"
                  value={l.mercancia_id}
                  onChange={(e) => {
                    const nueva = mercancias.find((x) => x.id === Number(e.target.value));
                    if (nueva) onCambiar(l.key, { mercancia_id: nueva.id, ganancia_pct: nueva.ganancia_pct });
                  }}
                >
                  {mercancias.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nombre} (por {x.pieza})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2">
                <Input label={m ? `Cuantas ${plural(m.pieza, 2)}` : "Cantidad"} type="number" min={1} step={1} value={l.cantidad} onChange={(e) => onCambiar(l.key, { cantidad: Number(e.target.value) })} />
              </div>
              <div className="col-span-3">
                <Input
                  label={m ? `Precio por ${m.pieza}` : "Precio"}
                  type="number"
                  min={0}
                  step="0.01"
                  value={l.costo_unitario || ""}
                  placeholder="0.00"
                  onChange={(e) => onCambiar(l.key, { costo_unitario: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-2">
                <Input label="Ganancia %" type="number" min={0} step="1" value={l.ganancia_pct} onChange={(e) => onCambiar(l.key, { ganancia_pct: Number(e.target.value) })} />
              </div>
              <div className="col-span-1 pb-2 text-right">
                <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => onQuitar(l.key)}>
                  Quitar
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
              <span>{m && l.costo_unitario > 0 ? `Cada ${m.pieza} se debe vender en ${formatMoney(l.costo_unitario * (1 + l.ganancia_pct / 100))} o mas.` : ""}</span>
              <span>Subtotal: {formatMoney(subtotal)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
