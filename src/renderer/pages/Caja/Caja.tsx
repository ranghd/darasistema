import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import type { Cliente, ModalidadLinea, Producto } from "../../lib/types";
import { formatMoney, todayIso } from "../../lib/format";
import { Button, Select } from "../../components/ui";

interface LineaCarrito {
  producto_id: number;
  cantidad: number;
  modalidad: ModalidadLinea;
}

const CATEGORIAS = [
  { value: "TODOS", label: "Todos" },
  { value: "GAS", label: "Gas" },
  { value: "OXIGENO", label: "Oxigeno" },
  { value: "AGUA", label: "Agua" },
  { value: "OTRO", label: "Otro" },
];

export default function Caja() {
  const navigate = useNavigate();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [clienteId, setClienteId] = useState<number | "">("");
  const [categoria, setCategoria] = useState("TODOS");
  const [busqueda, setBusqueda] = useState("");
  const [cobrando, setCobrando] = useState(false);
  const [error, setError] = useState("");

  async function cargar() {
    const [p, c] = await Promise.all([api.productos.listar(), api.clientes.listar()]);
    setProductos(p);
    setClientes(c);
    const consumidorFinal = c.find((x) => x.nombre === "Consumidor Final");
    setClienteId(consumidorFinal ? consumidorFinal.id : c[0]?.id ?? "");
  }

  useEffect(() => {
    cargar();
  }, []);

  function agregarProducto(p: Producto) {
    setError("");
    setCarrito((prev) => {
      const existente = prev.find((l) => l.producto_id === p.id);
      if (existente) {
        return prev.map((l) => (l.producto_id === p.id ? { ...l, cantidad: l.cantidad + 1 } : l));
      }
      return [...prev, { producto_id: p.id, cantidad: 1, modalidad: p.maneja_envase ? "INTERCAMBIO" : "LLENO" }];
    });
  }

  function cambiarCantidad(productoId: number, delta: number) {
    setCarrito((prev) =>
      prev
        .map((l) => (l.producto_id === productoId ? { ...l, cantidad: l.cantidad + delta } : l))
        .filter((l) => l.cantidad > 0)
    );
  }

  function cambiarModalidad(productoId: number, modalidad: ModalidadLinea) {
    setCarrito((prev) => prev.map((l) => (l.producto_id === productoId ? { ...l, modalidad } : l)));
  }

  function quitar(productoId: number) {
    setCarrito((prev) => prev.filter((l) => l.producto_id !== productoId));
  }

  function vaciarCarrito() {
    setCarrito([]);
    setError("");
  }

  const calculo = useMemo(() => {
    let subtotal = 0;
    let itbis = 0;
    let fianza = 0;
    const lineas = carrito.map((l) => {
      const producto = productos.find((p) => p.id === l.producto_id)!;
      const bruto = l.cantidad * producto.precio_contenido;
      const itbisLinea = bruto * (producto.itbis_rate ?? 0.18);
      const fianzaLinea = l.modalidad === "LLENO" && producto.maneja_envase ? producto.fianza_envase * l.cantidad : 0;
      subtotal += bruto;
      itbis += itbisLinea;
      fianza += fianzaLinea;
      return { ...l, producto, bruto, itbisLinea, fianzaLinea };
    });
    return { lineas, subtotal, itbis, fianza, total: subtotal + itbis + fianza };
  }, [carrito, productos]);

  const productosFiltrados = productos.filter((p) => {
    if (categoria !== "TODOS" && p.categoria !== categoria) return false;
    if (busqueda && !p.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return p.activo;
  });

  async function cobrar() {
    setError("");
    if (!clienteId) return setError("Seleccione un cliente");
    if (carrito.length === 0) return setError("Agregue al menos un producto");
    setCobrando(true);
    try {
      const factura = await api.facturas.crear({
        cliente_id: clienteId,
        fecha: todayIso(),
        condicion_pago: "CONTADO",
        tipo_ncf: "B02",
        lineas: carrito.map((l) => ({ producto_id: l.producto_id, modalidad: l.modalidad, cantidad: l.cantidad, precio_unitario: productos.find((p) => p.id === l.producto_id)!.precio_contenido, descuento: 0 })),
      });
      setCarrito([]);
      navigate(`/facturas/${(factura as any).id}`);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cobrar la venta");
    } finally {
      setCobrando(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-56px)] gap-5">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-xl font-semibold text-slate-900">Caja</h1>
          <input
            className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            placeholder="Buscar producto..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <div className="flex gap-1.5">
            {CATEGORIAS.map((c) => (
              <button
                key={c.value}
                onClick={() => setCategoria(c.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  categoria === c.value ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid flex-1 auto-rows-max grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
          {productosFiltrados.map((p) => (
            <button
              key={p.id}
              onClick={() => agregarProducto(p)}
              disabled={p.existencia <= 0}
              className="flex flex-col items-start rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-brand-600">{p.categoria}</span>
              <span className="mt-1 text-sm font-semibold text-slate-800">{p.nombre}</span>
              <span className="mt-1.5 text-base font-bold text-slate-900">{formatMoney(p.precio_contenido)}</span>
              <span className="mt-1 text-xs text-slate-400">Existencia: {p.existencia}</span>
            </button>
          ))}
          {productosFiltrados.length === 0 && <p className="col-span-full py-10 text-center text-sm text-slate-400">No hay productos que coincidan</p>}
        </div>
      </div>

      <div className="flex w-96 shrink-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4">
          <Select label="Cliente" value={clienteId} onChange={(e) => setClienteId(Number(e.target.value))}>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {calculo.lineas.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">Toca un producto para agregarlo</p>
          ) : (
            <div className="space-y-3">
              {calculo.lineas.map((l) => (
                <div key={l.producto_id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{l.producto.nombre}</span>
                    <button onClick={() => quitar(l.producto_id)} className="text-xs text-red-500 hover:underline">
                      Quitar
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button onClick={() => cambiarCantidad(l.producto_id, -1)} className="h-6 w-6 rounded bg-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-300">
                        -
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{l.cantidad}</span>
                      <button onClick={() => cambiarCantidad(l.producto_id, 1)} className="h-6 w-6 rounded bg-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-300">
                        +
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">{formatMoney(l.bruto + l.itbisLinea + l.fianzaLinea)}</span>
                  </div>
                  {l.producto.maneja_envase && (
                    <div className="mt-2 flex gap-1.5 text-xs">
                      <button
                        onClick={() => cambiarModalidad(l.producto_id, "INTERCAMBIO")}
                        className={`rounded-full px-2 py-0.5 ${l.modalidad === "INTERCAMBIO" ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600"}`}
                      >
                        Intercambio
                      </button>
                      <button
                        onClick={() => cambiarModalidad(l.producto_id, "LLENO")}
                        className={`rounded-full px-2 py-0.5 ${l.modalidad === "LLENO" ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-600"}`}
                      >
                        Lleno (+fianza)
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1 border-t border-slate-200 p-4 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{formatMoney(calculo.subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>ITBIS</span>
            <span>{formatMoney(calculo.itbis)}</span>
          </div>
          {calculo.fianza > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Fianza</span>
              <span>{formatMoney(calculo.fianza)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold text-slate-900">
            <span>Total</span>
            <span>{formatMoney(calculo.total)}</span>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" onClick={vaciarCarrito} disabled={carrito.length === 0}>
              Vaciar
            </Button>
            <Button className="flex-1" onClick={cobrar} disabled={cobrando || carrito.length === 0}>
              {cobrando ? "Cobrando..." : "Cobrar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
