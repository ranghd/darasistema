import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, mensajeDeError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { imprimirReciboFactura, type AvisoImpresion } from "../../lib/ticket";
import { useCaja } from "../../lib/caja";
import { hayModalAbierto } from "../../lib/atajos";
import CajaCerradaAviso from "../../components/CajaCerradaAviso";
import type { Cliente, ModalidadLinea, Producto } from "../../lib/types";
import { formatMoney, todayIso } from "../../lib/format";
import { Button, Modal } from "../../components/ui";

interface LineaCarrito {
  producto_id: number;
  cantidad: number;
  modalidad: ModalidadLinea;
}

type Metodo = "EFECTIVO" | "TARJETA" | "TRANSFERENCIA";

const METODOS: { valor: Metodo; nombre: string; tecla: string }[] = [
  { valor: "EFECTIVO", nombre: "Efectivo", tecla: "F6" },
  { valor: "TARJETA", nombre: "Tarjeta", tecla: "F7" },
  { valor: "TRANSFERENCIA", nombre: "Transferencia", tecla: "F8" },
];

const CATEGORIAS = [
  { value: "TODOS", label: "Todos" },
  { value: "GAS", label: "Gas" },
  { value: "OXIGENO", label: "Oxigeno" },
  { value: "AGUA", label: "Agua" },
  { value: "OTRO", label: "Otro" },
];

const sinAcentos = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const r2 = (n: number) => Math.round(n * 100) / 100;

// "3*gas" -> 3 unidades de lo que coincida con "gas".
function leerBusqueda(texto: string): { cantidad: number; q: string } {
  const m = texto.match(/^\s*(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/);
  if (m) return { cantidad: Number(m[1].replace(",", ".")) || 1, q: m[2] };
  return { cantidad: 1, q: texto };
}

function Tecla({ children }: { children: React.ReactNode }) {
  return <kbd className="ml-1 rounded border border-slate-300 px-1 font-mono text-[10px] opacity-70">{children}</kbd>;
}

export default function Caja() {
  const { usuario } = useAuth();
  const { sesion, usaCaja, recargar: recargarCaja } = useCaja();
  const navigate = useNavigate();
  const buscador = useRef<HTMLInputElement>(null);

  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [clienteId, setClienteId] = useState<number | "">("");
  const [categoria, setCategoria] = useState("TODOS");
  const [busqueda, setBusqueda] = useState("");
  const [resaltado, setResaltado] = useState(0);
  const [lineaSel, setLineaSel] = useState(-1);
  const [metodoPago, setMetodoPago] = useState<Metodo>("EFECTIVO");
  const [error, setError] = useState("");

  const [eligiendoCliente, setEligiendoCliente] = useState(false);
  const [textoCliente, setTextoCliente] = useState("");
  const [clienteSel, setClienteSel] = useState(0);
  const [pagando, setPagando] = useState(false);
  const [recibido, setRecibido] = useState("");
  const [cobrando, setCobrando] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [venta, setVenta] = useState<{ id: number; ncf: string | null; total: number; devuelta: number | null; metodo: Metodo; aviso: AvisoImpresion | null; impresoSolo: boolean } | null>(null);
  const [imprimiendo, setImprimiendo] = useState(false);

  const enfocar = () => setTimeout(() => buscador.current?.focus(), 0);

  async function cargar() {
    const [p, c] = await Promise.all([api.productos.listar(), api.clientes.listar()]);
    setProductos(p);
    setClientes(c);
    const consumidorFinal = c.find((x) => x.nombre === "Consumidor Final");
    setClienteId(consumidorFinal ? consumidorFinal.id : c[0]?.id ?? "");
  }

  useEffect(() => {
    cargar();
    enfocar();
  }, []);

  const { cantidad: cantidadBuscada, q } = leerBusqueda(busqueda);

  const resultados = useMemo(() => {
    const t = sinAcentos(q.trim());
    const lista = productos.filter((p) => {
      if (!p.activo) return false;
      if (categoria !== "TODOS" && p.categoria !== categoria) return false;
      return !t || sinAcentos(p.nombre).includes(t) || sinAcentos(p.codigo).includes(t);
    });
    // Un codigo exacto (lector de codigos de barras) va primero.
    return lista.sort((a, b) => Number(sinAcentos(b.codigo) === t) - Number(sinAcentos(a.codigo) === t));
  }, [productos, categoria, q]);

  useEffect(() => setResaltado(0), [q, categoria]);

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
    return { lineas, subtotal, itbis, fianza, total: r2(subtotal + itbis + fianza) };
  }, [carrito, productos]);

  // ---------- carrito ----------
  function agregar(p: Producto, cantidad = 1) {
    setError("");
    const actual = carrito.find((l) => l.producto_id === p.id)?.cantidad ?? 0;
    if (actual + cantidad > p.existencia) {
      setError(`No hay suficiente ${p.nombre}: quedan ${p.existencia}.`);
      return;
    }
    const i = carrito.findIndex((l) => l.producto_id === p.id);
    if (i >= 0) {
      setCarrito(carrito.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + cantidad } : l)));
      setLineaSel(i);
    } else {
      setCarrito([...carrito, { producto_id: p.id, cantidad, modalidad: p.maneja_envase ? "INTERCAMBIO" : "LLENO" }]);
      setLineaSel(carrito.length);
    }
    setBusqueda("");
    enfocar();
  }

  function cambiarCantidad(i: number, delta: number) {
    const l = carrito[i];
    if (!l) return;
    const p = productos.find((x) => x.id === l.producto_id);
    if (delta > 0 && p && l.cantidad + delta > p.existencia) return setError(`No hay suficiente ${p.nombre}: quedan ${p.existencia}.`);
    setError("");
    const nuevo = carrito.map((x, j) => (j === i ? { ...x, cantidad: x.cantidad + delta } : x)).filter((x) => x.cantidad > 0);
    setCarrito(nuevo);
    setLineaSel(Math.min(i, nuevo.length - 1));
  }

  function quitar(i: number) {
    const nuevo = carrito.filter((_, j) => j !== i);
    setCarrito(nuevo);
    setLineaSel(Math.min(i, nuevo.length - 1));
    enfocar();
  }

  function alternarModalidad(i: number, modalidad?: ModalidadLinea) {
    const l = calculo.lineas[i];
    if (!l || !l.producto.maneja_envase) return;
    setCarrito(carrito.map((x, j) => (j === i ? { ...x, modalidad: modalidad ?? (x.modalidad === "LLENO" ? "INTERCAMBIO" : "LLENO") } : x)));
  }

  function nuevaVenta() {
    setCarrito([]);
    setLineaSel(-1);
    setBusqueda("");
    setError("");
    setMetodoPago("EFECTIVO");
    const consumidorFinal = clientes.find((x) => x.nombre === "Consumidor Final");
    if (consumidorFinal) setClienteId(consumidorFinal.id);
    enfocar();
  }

  // ---------- cobro ----------
  function iniciarCobro() {
    setError("");
    if (!clienteId) return setError("Elige un cliente (F2)");
    if (carrito.length === 0) return setError("Agrega al menos un producto");
    if (usaCaja && !sesion) return setError("La caja esta cerrada. Abre la caja en Cierre de Caja para poder cobrar.");
    setRecibido(calculo.total.toFixed(2));
    setPagando(true);
  }

  const montoRecibido = Number(recibido.replace(",", ".")) || 0;
  const devuelta = r2(montoRecibido - calculo.total);

  async function confirmarCobro(e?: React.FormEvent) {
    e?.preventDefault();
    if (cobrando) return;
    if (metodoPago === "EFECTIVO" && devuelta < 0) return;
    setCobrando(true);
    try {
      const factura = (await api.facturas.crear({
        cliente_id: clienteId as number,
        fecha: todayIso(),
        condicion_pago: "CONTADO",
        metodo_pago: metodoPago,
        tipo_ncf: "B02",
        creado_por: usuario?.nombre,
        caja_sesion_id: sesion?.id ?? null,
        lineas: carrito.map((l) => ({ producto_id: l.producto_id, modalidad: l.modalidad, cantidad: l.cantidad, precio_unitario: productos.find((p) => p.id === l.producto_id)!.precio_contenido, descuento: 0 })),
      })) as any;
      setPagando(false);
      const cfg = await api.impresion.obtenerConfig().catch(() => null);
      const auto = cfg?.formato === "TICKET" && cfg.imprimirAlCobrar;
      setVenta({
        id: factura.id,
        ncf: factura.ncf,
        total: factura.total,
        devuelta: metodoPago === "EFECTIVO" ? devuelta : null,
        metodo: metodoPago,
        aviso: auto ? await imprimirReciboFactura(factura.id, cfg!) : null,
        impresoSolo: !!auto,
      });
      setCarrito([]);
      setLineaSel(-1);
      api.productos.listar().then(setProductos); // existencias al dia
    } catch (err) {
      setPagando(false);
      const msg = mensajeDeError(err, "No se pudo cobrar la venta");
      setError(msg);
      if (/caja ya fue cerrada|jornada/i.test(msg)) recargarCaja();
      enfocar();
    } finally {
      setCobrando(false);
    }
  }

  async function imprimirVenta() {
    if (!venta) return;
    setImprimiendo(true);
    const aviso = await imprimirReciboFactura(venta.id);
    setVenta({ ...venta, aviso });
    setImprimiendo(false);
  }

  function cerrarVenta() {
    setVenta(null);
    nuevaVenta();
  }

  // ---------- teclado ----------
  const estado = useRef({ iniciarCobro, alternarModalidad, lineaSel, busqueda, carrito, setMetodoPago });
  estado.current = { iniciarCobro, alternarModalidad, lineaSel, busqueda, carrito, setMetodoPago };

  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => {
      if (hayModalAbierto()) return; // las ventanas manejan su propio teclado
      const s = estado.current;
      const metodo = { F6: "EFECTIVO", F7: "TARJETA", F8: "TRANSFERENCIA" }[e.key] as Metodo | undefined;
      if (metodo) {
        e.preventDefault();
        s.setMetodoPago(metodo);
      } else if (e.key === "F12" || ((e.ctrlKey || e.metaKey) && e.key === "Enter")) {
        e.preventDefault();
        s.iniciarCobro();
      } else if (e.key === "F2") {
        e.preventDefault();
        setTextoCliente("");
        setClienteSel(0);
        setEligiendoCliente(true);
      } else if (e.key === "F4") {
        e.preventDefault();
        s.alternarModalidad(s.lineaSel >= 0 ? s.lineaSel : s.carrito.length - 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (s.busqueda) {
          setBusqueda("");
          enfocar();
        } else if (s.carrito.length) setConfirmarCancelar(true); // el foco va al boton "Si, cancelar"
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement !== buscador.current) {
        // escribir en cualquier parte de la caja va al buscador
        buscador.current?.focus();
      }
    };
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, []);

  function teclaBuscador(e: React.KeyboardEvent<HTMLInputElement>) {
    const vacio = busqueda.trim() === "";
    const seleccion = lineaSel >= 0 ? lineaSel : carrito.length - 1;
    if (e.key === "Enter") {
      e.preventDefault();
      if (vacio) return;
      const p = resultados[resaltado];
      if (!p) return setError(`No hay ningun producto que coincida con "${q}"`);
      if (p.existencia <= 0) return setError(`${p.nombre} no tiene existencia`);
      agregar(p, cantidadBuscada);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      if (!vacio) setResaltado((r) => Math.max(0, Math.min(r + d, resultados.length - 1)));
      else if (carrito.length) setLineaSel(Math.max(0, Math.min(seleccion + d, carrito.length - 1)));
    } else if (vacio && (e.key === "+" || e.key === "-")) {
      e.preventDefault();
      cambiarCantidad(seleccion, e.key === "+" ? 1 : -1);
    } else if (vacio && e.key === "Delete" && carrito.length) {
      e.preventDefault();
      quitar(seleccion);
    }
  }

  // ---------- clientes (F2) ----------
  const clientesFiltrados = useMemo(() => {
    const t = sinAcentos(textoCliente.trim());
    return clientes.filter((c) => c.activo !== 0 && (!t || sinAcentos(`${c.nombre} ${c.codigo} ${c.rnc_cedula ?? ""} ${c.telefono ?? ""}`).includes(t))).slice(0, 50);
  }, [clientes, textoCliente]);

  function elegirCliente(c: Cliente | undefined) {
    if (!c) return;
    setClienteId(c.id);
    setEligiendoCliente(false);
    enfocar();
  }

  const cliente = clientes.find((c) => c.id === clienteId);
  const seleccionVisible = lineaSel >= 0 ? lineaSel : carrito.length - 1;
  const billetesRapidos = [...new Set([Math.ceil(calculo.total / 100) * 100, Math.ceil(calculo.total / 500) * 500, Math.ceil(calculo.total / 1000) * 1000, 2000])]
    .filter((v) => v > calculo.total)
    .slice(0, 3);

  return (
    <div className="flex h-[calc(100vh-56px)] gap-5" data-nav-propio>
      <div className="flex min-w-0 flex-1 flex-col">
        <CajaCerradaAviso />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="mr-1 text-xl font-semibold text-slate-900">Caja</h1>
          {sesion && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{sesion.caja_nombre} abierta</span>}
          <div className="relative min-w-[18rem] flex-1">
            <input
              ref={buscador}
              className="w-full rounded-lg border-2 border-brand-300 px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              placeholder="Escribe producto o codigo y Enter  (3* para varias unidades)"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={teclaBuscador}
            />
            {cantidadBuscada > 1 && <span className="absolute right-3 top-2.5 rounded bg-brand-600 px-1.5 text-xs font-bold text-white">×{cantidadBuscada}</span>}
          </div>
          <div className="flex gap-1.5">
            {CATEGORIAS.map((c) => (
              <button
                key={c.value}
                tabIndex={-1}
                onClick={() => {
                  setCategoria(c.value);
                  enfocar();
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium ${categoria === c.value ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid flex-1 auto-rows-max grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
          {resultados.map((p, i) => (
            <button
              key={p.id}
              tabIndex={-1}
              onClick={() => agregar(p)}
              disabled={p.existencia <= 0}
              className={`flex flex-col items-start rounded-xl border bg-white p-3 text-left shadow-sm transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 ${
                busqueda.trim() && i === resaltado ? "border-brand-500 ring-2 ring-brand-200" : "border-slate-200"
              }`}
            >
              <span className="flex w-full justify-between text-xs font-medium uppercase tracking-wide text-brand-600">
                {p.categoria}
                <span className="font-mono normal-case text-slate-400">{p.codigo}</span>
              </span>
              <span className="mt-1 text-sm font-semibold text-slate-800">{p.nombre}</span>
              <span className="mt-1.5 text-base font-bold text-slate-900">{formatMoney(p.precio_contenido)}</span>
              <span className="mt-1 text-xs text-slate-400">Existencia: {p.existencia}</span>
            </button>
          ))}
          {resultados.length === 0 && <p className="col-span-full py-10 text-center text-sm text-slate-400">No hay productos que coincidan</p>}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          ↑↓ elegir · Enter agregar · + / − cantidad · Supr quitar · F2 cliente · F4 lleno/intercambio · F6-F8 pago · F12 cobrar · Esc cancelar · F1 ayuda
        </p>
      </div>

      <div className="flex w-96 shrink-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setTextoCliente("");
            setClienteSel(0);
            setEligiendoCliente(true);
          }}
          className="flex items-center justify-between border-b border-slate-200 p-4 text-left hover:bg-slate-50"
        >
          <span>
            <span className="block text-xs text-slate-400">Cliente</span>
            <span className="block text-sm font-semibold text-slate-800">{cliente?.nombre ?? "Elegir cliente"}</span>
          </span>
          <span className="text-xs text-brand-600">
            Cambiar <Tecla>F2</Tecla>
          </span>
        </button>

        <div className="flex-1 overflow-y-auto p-4">
          {calculo.lineas.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">Escribe un producto y presiona Enter, o tocalo</p>
          ) : (
            <div className="space-y-2">
              {calculo.lineas.map((l, i) => (
                <div
                  key={l.producto_id}
                  onClick={() => setLineaSel(i)}
                  className={`cursor-pointer rounded-lg border p-2.5 ${i === seleccionVisible ? "border-brand-400 bg-brand-50/60" : "border-slate-100 bg-slate-50"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{l.producto.nombre}</span>
                    <button tabIndex={-1} onClick={() => quitar(i)} className="text-xs text-red-500 hover:underline">
                      Quitar
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button tabIndex={-1} onClick={() => cambiarCantidad(i, -1)} className="h-6 w-6 rounded bg-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-300">
                        -
                      </button>
                      <span className="w-8 text-center text-sm font-medium">{l.cantidad}</span>
                      <button tabIndex={-1} onClick={() => cambiarCantidad(i, 1)} className="h-6 w-6 rounded bg-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-300">
                        +
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">{formatMoney(l.bruto + l.itbisLinea + l.fianzaLinea)}</span>
                  </div>
                  {l.producto.maneja_envase && (
                    <div className="mt-2 flex gap-1.5 text-xs">
                      <button
                        tabIndex={-1}
                        onClick={() => alternarModalidad(i, "INTERCAMBIO")}
                        className={`rounded-full px-2 py-0.5 ${l.modalidad === "INTERCAMBIO" ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600"}`}
                      >
                        Intercambio
                      </button>
                      <button
                        tabIndex={-1}
                        onClick={() => alternarModalidad(i, "LLENO")}
                        className={`rounded-full px-2 py-0.5 ${l.modalidad === "LLENO" ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-600"}`}
                      >
                        Lleno (+fianza)
                      </button>
                      {i === seleccionVisible && <span className="self-center text-[10px] text-slate-400">F4</span>}
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

          <div className="flex gap-1 pt-2">
            {METODOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                tabIndex={-1}
                onClick={() => setMetodoPago(m.valor)}
                className={`flex-1 rounded-lg border px-1 py-1.5 text-xs font-medium ${metodoPago === m.valor ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}
              >
                {m.nombre}
                <Tecla>{m.tecla}</Tecla>
              </button>
            ))}
          </div>

          {error && <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" tabIndex={-1} onClick={() => carrito.length && setConfirmarCancelar(true)} disabled={carrito.length === 0}>
              Cancelar <Tecla>Esc</Tecla>
            </Button>
            <Button className="flex-1" onClick={iniciarCobro} disabled={cobrando || carrito.length === 0 || (usaCaja && !sesion)}>
              Cobrar <Tecla>F12</Tecla>
            </Button>
          </div>
        </div>
      </div>

      {/* Cliente (F2) */}
      <Modal open={eligiendoCliente} onClose={() => (setEligiendoCliente(false), enfocar())} title="Elegir cliente">
        <input
          autoFocus
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          placeholder="Nombre, codigo, RNC o telefono"
          value={textoCliente}
          onChange={(e) => {
            setTextoCliente(e.target.value);
            setClienteSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setClienteSel((s) => Math.min(s + 1, clientesFiltrados.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setClienteSel((s) => Math.max(s - 1, 0)));
            else if (e.key === "Enter") (e.preventDefault(), elegirCliente(clientesFiltrados[clienteSel]));
          }}
        />
        <div className="mt-3 max-h-80 overflow-y-auto">
          {clientesFiltrados.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => setClienteSel(i)}
              onClick={() => elegirCliente(c)}
              className={`flex w-full justify-between rounded-lg px-3 py-2 text-left text-sm ${i === clienteSel ? "bg-brand-50 text-brand-800" : "text-slate-700"}`}
            >
              <span className="font-medium">{c.nombre}</span>
              <span className="text-xs text-slate-400">{[c.codigo, c.rnc_cedula].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
          {clientesFiltrados.length === 0 && <p className="py-4 text-center text-sm text-slate-400">Ningun cliente coincide</p>}
        </div>
        <p className="mt-2 text-xs text-slate-400">↑ ↓ elegir · Enter confirmar · Esc volver</p>
      </Modal>

      {/* Cobrar (F12) */}
      <Modal open={pagando} onClose={() => (setPagando(false), enfocar())} title="Cobrar">
        <form onSubmit={confirmarCobro} className="space-y-4">
          <div className="flex items-end justify-between">
            <span className="text-sm text-slate-500">Total a cobrar</span>
            <span className="text-3xl font-bold text-slate-900">{formatMoney(calculo.total)}</span>
          </div>
          <div
            className="flex gap-1"
            onKeyDown={(e) => {
              const m = { F6: "EFECTIVO", F7: "TARJETA", F8: "TRANSFERENCIA" }[e.key] as Metodo | undefined;
              if (m) (e.preventDefault(), setMetodoPago(m));
            }}
          >
            {METODOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                tabIndex={-1}
                onClick={() => setMetodoPago(m.valor)}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium ${metodoPago === m.valor ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}
              >
                {m.nombre}
                <Tecla>{m.tecla}</Tecla>
              </button>
            ))}
          </div>
          {metodoPago === "EFECTIVO" ? (
            <div
              className="space-y-2"
              onKeyDown={(e) => {
                const m = { F6: "EFECTIVO", F7: "TARJETA", F8: "TRANSFERENCIA" }[e.key] as Metodo | undefined;
                if (m) (e.preventDefault(), setMetodoPago(m));
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Recibido del cliente</span>
                <input
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  inputMode="decimal"
                  className="w-full rounded-lg border-2 border-brand-300 px-3 py-2 text-2xl font-semibold outline-none focus:border-brand-500"
                  value={recibido}
                  onChange={(e) => setRecibido(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                {billetesRapidos.map((v) => (
                  <button key={v} type="button" tabIndex={-1} onClick={() => setRecibido(v.toFixed(2))} className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50">
                    {formatMoney(v)}
                  </button>
                ))}
              </div>
              <div className={`flex items-end justify-between rounded-lg px-3 py-3 ${devuelta < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
                <span className="text-sm font-medium">{devuelta < 0 ? "Falta" : "Devuelta"}</span>
                <span className="text-3xl font-bold">{formatMoney(Math.abs(devuelta))}</span>
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">Confirma que el pago con {metodoPago === "TARJETA" ? "tarjeta" : "transferencia"} fue aprobado.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => (setPagando(false), enfocar())}>
              Volver <Tecla>Esc</Tecla>
            </Button>
            <Button type="submit" autoFocus={metodoPago !== "EFECTIVO"} disabled={cobrando || (metodoPago === "EFECTIVO" && devuelta < 0)}>
              {cobrando ? "Cobrando..." : "Confirmar cobro"} <Tecla>Enter</Tecla>
            </Button>
          </div>
        </form>
      </Modal>

      {/* Venta realizada */}
      <Modal open={!!venta} onClose={cerrarVenta} title="Venta registrada">
        {venta && (
          <div className="space-y-4">
            <div className="flex justify-between text-sm text-slate-600">
              <span>
                NCF <span className="font-mono">{venta.ncf}</span>
              </span>
              <span>Total {formatMoney(venta.total)}</span>
            </div>
            {venta.devuelta !== null && (
              <div className="flex items-end justify-between rounded-lg bg-emerald-50 px-4 py-4 text-emerald-800">
                <span className="text-sm font-medium">Devuelta</span>
                <span className="text-4xl font-bold">{formatMoney(venta.devuelta)}</span>
              </div>
            )}
            {venta.aviso && <p className={`rounded-lg px-3 py-2 text-sm ${venta.aviso.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{venta.aviso.texto}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => navigate(`/facturas/${venta.id}`)}>
                Ver factura
              </Button>
              <Button variant="secondary" autoFocus={venta.impresoSolo} onClick={cerrarVenta}>
                Nueva venta <Tecla>Esc</Tecla>
              </Button>
              {!venta.impresoSolo && (
                <Button autoFocus onClick={imprimirVenta} disabled={imprimiendo}>
                  {imprimiendo ? "Imprimiendo..." : "Imprimir recibo"} <Tecla>Enter</Tecla>
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Cancelar venta (Esc) */}
      <Modal open={confirmarCancelar} onClose={() => (setConfirmarCancelar(false), enfocar())} title="Cancelar la venta">
        <p className="text-sm text-slate-600">Se quitan todos los productos del carrito. No se guarda nada.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => (setConfirmarCancelar(false), enfocar())}>
            Seguir vendiendo <Tecla>Esc</Tecla>
          </Button>
          <Button
            variant="danger"
            autoFocus
            onClick={() => {
              setConfirmarCancelar(false);
              nuevaVenta();
            }}
          >
            Si, cancelar <Tecla>Enter</Tecla>
          </Button>
        </div>
      </Modal>
    </div>
  );
}
