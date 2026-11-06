import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, mensajeDeError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { imprimirReciboFactura, type AvisoImpresion } from "../../lib/ticket";
import { useCaja } from "../../lib/caja";
import { hayModalAbierto } from "../../lib/atajos";
import CajaCerradaAviso from "../../components/CajaCerradaAviso";
import AvisoBorrador from "../../components/AvisoBorrador";
import { useBorrador, useHabiaBorrador } from "../../lib/borrador";
import type { Cliente, ModalidadLinea, PlatoDia, Producto, TipoNcfVenta } from "../../lib/types";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { NCF_LABELS, TIPOS_NCF_VENTA, VERSION_CODIGOS_NCF } from "../../lib/ncf";
import { Button, Modal } from "../../components/ui";
import { esColmado, esFritura, manejaEnvases, soloVentas, usaGrupos } from "../../lib/variant";
import { imprimirFacturaGasDamian } from "../../lib/reciboGasDamian";
import TablaFactura from "./TablaFactura";
import { leerBusqueda, sinAcentos } from "./buscar";
import { leerPrecios } from "../../lib/precios";

interface LineaCarrito {
  producto_id: number;
  cantidad: number;
  modalidad: ModalidadLinea;
  /** Gas Damian: el cliente se lleva el cilindro prestado. */
  prestado?: boolean;
  /** Gas Damian: precio elegido entre los otros precios (sin ITBIS); sin el, el precio normal. */
  precio?: number;
}

// Gas Damian: que pasa con el cilindro, en palabras de todos los dias.
type ModoCilindro = "TRAJO" | "NUEVO" | "PRESTADO";
const MODOS_CILINDRO: { modo: ModoCilindro; texto: string; color: string }[] = [
  { modo: "TRAJO", texto: "🔄 Trajo el suyo", color: "bg-brand-600 text-white" },
  { modo: "NUEVO", texto: "🆕 Se lleva uno nuevo", color: "bg-amber-500 text-white" },
  { modo: "PRESTADO", texto: "🤝 Se lo presto", color: "bg-violet-600 text-white" },
];
const modoDe = (l: LineaCarrito): ModoCilindro => (l.prestado ? "PRESTADO" : l.modalidad === "LLENO" ? "NUEVO" : "TRAJO");

// Gas Damian: un color por categoria para reconocer las tarjetas de un vistazo.
const COLORES_CATEGORIA = ["border-t-sky-500", "border-t-amber-500", "border-t-emerald-500", "border-t-violet-500", "border-t-rose-500", "border-t-teal-500", "border-t-orange-500"];
const colorDe = (grupo: string) => COLORES_CATEGORIA[[...grupo].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORES_CATEGORIA.length];

// FIADO (solo Gas Damian): la venta queda a credito y se cobra despues en Fiados.
type Metodo = "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "FIADO";

const METODOS: { valor: Metodo; nombre: string; tecla: string }[] = [
  { valor: "EFECTIVO", nombre: "Efectivo", tecla: "F6 · Ctrl1" },
  { valor: "TARJETA", nombre: "Tarjeta", tecla: "F7 · Ctrl2" },
  { valor: "TRANSFERENCIA", nombre: "Transferencia", tecla: "F8 · Ctrl3" },
  ...(soloVentas ? [{ valor: "FIADO" as const, nombre: "Fiado", tecla: "Ctrl4" }] : []),
];

// Comprobantes que piden el RNC del cliente.
const PIDEN_RNC: TipoNcfVenta[] = ["B01", "B14", "B15"];

// Campos del cliente en la caja de Gas Damian (nombre, RNC, razon social).
const CAMPO_CLIENTE = "w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100";

// Categoria de un producto en las pestanas (colmado y Gas Damian). Si no tiene, se usa su tipo.
const TIPO_A_GRUPO: Record<string, string> = { GAS: "Gas propano", OXIGENO: "Oxigeno", AGUA: "Agua" };
const grupoDe = (p: Producto) => p.grupo || (soloVentas ? TIPO_A_GRUPO[p.categoria] ?? "Otros" : "Otros");

const CATEGORIAS = [
  { value: "TODOS", label: "Todos" },
  { value: "GAS", label: "Gas" },
  { value: "OXIGENO", label: "Oxigeno" },
  { value: "AGUA", label: "Agua" },
  { value: "OTRO", label: "Otro" },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

function Tecla({ children }: { children: React.ReactNode }) {
  // en Gas Damian no se muestran las teclas (siguen funcionando): la pantalla queda mas limpia
  if (soloVentas) return null;
  return <kbd className="ml-1 rounded border border-slate-300 px-1 font-mono text-[10px] opacity-70">{children}</kbd>;
}

export default function Caja() {
  const { usuario } = useAuth();
  const { sesion, usaCaja, recargar: recargarCaja } = useCaja();
  const navigate = useNavigate();
  const buscador = useRef<HTMLInputElement>(null);

  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  // La venta a medias se guarda sola: si vas a otra seccion y vuelves, sigue ahi.
  const [carrito, setCarrito] = useBorrador<LineaCarrito[]>("venta.carrito", []);
  const [clienteId, setClienteId] = useBorrador<number | "">("venta.cliente", "");
  // Gas Damian: a Consumidor Final se le puede escribir el nombre (ej. Jose) y sale en la factura.
  const [nombreCliente, setNombreCliente] = useBorrador<string>("venta.nombre", "");
  // Y si se le escribe un RNC, la factura sale con valor fiscal (B01) y el cliente se registra solo.
  const [rncCliente, setRncCliente] = useBorrador<string>("venta.rnc", "");
  // Gas Damian: el comprobante que eligio el cajero (null = el que toca solo: B01 con RNC, si no B02)
  const [tipoElegido, setTipoElegido] = useBorrador<TipoNcfVenta | null>("venta.tipoNcf", null);
  const [telefonoFiado, setTelefonoFiado] = useState("");
  // Dara Frituras: la linea a la que se le esta cambiando el precio y lo que se va escribiendo (precio final)
  const [cambiandoPrecio, setCambiandoPrecio] = useState<{ i: number; texto: string } | null>(null);
  const habiaVenta = useHabiaBorrador("venta.carrito", (v) => Array.isArray(v) && v.length > 0);
  const [avisoRecuperada, setAvisoRecuperada] = useState(habiaVenta);
  // Dara Frituras: abre en los platos de hoy
  const [categoria, setCategoria] = useState(esFritura ? "HOY" : "TODOS");
  const [platosHoy, setPlatosHoy] = useState<PlatoDia[]>([]);
  // En el colmado y en Gas Damian las pestanas son las categorias de los productos (Viveres, Bebidas... / Oxigeno, Acetileno...).
  const pestanas = usaGrupos
    ? [...(esFritura ? [{ value: "HOY", label: "Hoy" }] : []), { value: "TODOS", label: "Todos" }, ...Array.from(new Set(productos.filter((p) => p.activo).map(grupoDe))).sort().map((g) => ({ value: g, label: g }))]
    : CATEGORIAS;
  const [busqueda, setBusqueda] = useState("");
  const [resaltado, setResaltado] = useState(0);
  const [lineaSel, setLineaSel] = useState(-1);
  const [metodoPago, setMetodoPago] = useBorrador<Metodo>("venta.metodo", "EFECTIVO");
  const [error, setError] = useState("");

  const [eligiendoCliente, setEligiendoCliente] = useState(false);
  const [textoCliente, setTextoCliente] = useState("");
  const [clienteSel, setClienteSel] = useState(0);
  const [pagando, setPagando] = useState(false);
  const [recibido, setRecibido] = useState("");
  const [cobrando, setCobrando] = useState(false);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [venta, setVenta] = useState<{ id: number; ncf: string | null; total: number; devuelta: number | null; metodo: Metodo; fiadoA?: string; aviso: AvisoImpresion | null; impresoSolo: boolean } | null>(null);
  const [imprimiendo, setImprimiendo] = useState(false);

  const enfocar = () => setTimeout(() => buscador.current?.focus(), 0);

  // Un plato de hoy se vende a su precio de hoy, hasta donde alcancen sus porciones y su existencia.
  async function traerProductos(): Promise<Producto[]> {
    const [p, platos] = await Promise.all([api.productos.listar() as Promise<Producto[]>, esFritura ? api.platos.listar(todayIso()) : Promise.resolve([] as PlatoDia[])]);
    const lista = p.map((x) => {
      const plato = platos.find((d) => d.producto_id === x.id);
      return plato ? { ...x, precio_contenido: plato.precio, existencia: Math.min(plato.quedan, x.existencia) } : x;
    });
    setPlatosHoy(platos);
    setProductos(lista);
    return lista;
  }

  async function cargar() {
    const [p, c] = await Promise.all([traerProductos(), api.clientes.listar()]);
    setClientes(c);
    const consumidorFinal = c.find((x) => x.nombre === "Consumidor Final");
    // Si habia una venta a medias se respeta su cliente; si no, Consumidor Final.
    setClienteId((prev) => (prev && c.some((x) => x.id === prev) ? prev : consumidorFinal ? consumidorFinal.id : c[0]?.id ?? ""));
    setCarrito((prev) => prev.filter((l) => p.some((x) => x.id === l.producto_id && x.activo)));
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
      if (categoria === "HOY") {
        if (!t && !platosHoy.some((d) => d.producto_id === p.id)) return false;
      } else if (categoria !== "TODOS" && (usaGrupos ? grupoDe(p) : p.categoria) !== categoria) return false;
      return !t || sinAcentos(p.nombre).includes(t) || sinAcentos(p.codigo).includes(t);
    });
    // Un codigo exacto (lector de codigos de barras) va primero.
    return lista.sort((a, b) => Number(sinAcentos(b.codigo) === t) - Number(sinAcentos(a.codigo) === t));
  }, [productos, categoria, q, platosHoy]);

  useEffect(() => setResaltado(0), [q, categoria]);

  const calculo = useMemo(() => {
    let subtotal = 0;
    let itbis = 0;
    let fianza = 0;
    const lineas = carrito.filter((l) => productos.some((p) => p.id === l.producto_id)).map((l) => {
      const producto = productos.find((p) => p.id === l.producto_id)!;
      const bruto = l.cantidad * (l.precio ?? producto.precio_contenido);
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
  // Devuelve la linea donde quedo el producto (-1 si no hay existencia).
  function agregar(p: Producto, cantidad = 1, volverAlBuscador = true): number {
    setError("");
    const actual = carrito.find((l) => l.producto_id === p.id)?.cantidad ?? 0;
    if (r2(actual + cantidad) > p.existencia) {
      setError(`No hay suficiente ${p.nombre}: quedan ${p.existencia}.`);
      return -1;
    }
    let i = carrito.findIndex((l) => l.producto_id === p.id);
    if (i >= 0) {
      setCarrito(carrito.map((l, j) => (j === i ? { ...l, cantidad: r2(l.cantidad + cantidad) } : l)));
    } else {
      i = carrito.length;
      setCarrito([...carrito, { producto_id: p.id, cantidad, modalidad: p.maneja_envase ? "INTERCAMBIO" : "LLENO" }]);
    }
    setLineaSel(i);
    setBusqueda("");
    if (volverAlBuscador) enfocar();
    return i;
  }

  // Cantidad escrita en la tabla (0 quita la linea).
  function fijarCantidad(i: number, cantidad: number): boolean {
    const l = carrito[i];
    if (!l) return false;
    if (cantidad <= 0) {
      quitar(i);
      return true;
    }
    const p = productos.find((x) => x.id === l.producto_id);
    if (p && cantidad > p.existencia) {
      setError(`No hay suficiente ${p.nombre}: quedan ${p.existencia}.`);
      return false;
    }
    setError("");
    setCarrito(carrito.map((x, j) => (j === i ? { ...x, cantidad: r2(cantidad) } : x)));
    return true;
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
    setCarrito(carrito.map((x, j) => (j === i ? { ...x, prestado: false, modalidad: modalidad ?? (x.modalidad === "LLENO" ? "INTERCAMBIO" : "LLENO") } : x)));
  }

  function elegirPrecio(i: number, precio: number | undefined) {
    setCarrito(carrito.map((x, j) => (j === i ? { ...x, precio } : x)));
  }

  // El precio se escribe final (con ITBIS) y se guarda sin ITBIS, con 4 decimales para que el total de exacto.
  function guardarPrecio(i: number) {
    const l = calculo.lineas[i];
    const final = Number((cambiandoPrecio?.texto ?? "").replace(",", "."));
    setCambiandoPrecio(null);
    if (!l || !(final > 0)) return;
    const base = Math.round((final / (1 + (l.producto.itbis_rate ?? 0.18))) * 10000) / 10000;
    elegirPrecio(i, Math.abs(base - l.producto.precio_contenido) < 0.00005 ? undefined : base);
  }

  function elegirModo(i: number, modo: ModoCilindro) {
    setCarrito(carrito.map((x, j) => (j === i ? { ...x, modalidad: modo === "NUEVO" ? "LLENO" : "INTERCAMBIO", prestado: modo === "PRESTADO" } : x)));
  }

  function nuevaVenta() {
    setAvisoRecuperada(false);
    setCarrito([]);
    setLineaSel(-1);
    setBusqueda("");
    setError("");
    setMetodoPago("EFECTIVO");
    const consumidorFinal = clientes.find((x) => x.nombre === "Consumidor Final");
    if (consumidorFinal) setClienteId(consumidorFinal.id);
    setNombreCliente("");
    setRncCliente("");
    setTipoElegido(null);
    setTelefonoFiado("");
    enfocar();
  }

  // ---------- cobro ----------
  function iniciarCobro() {
    setError("");
    if (!clienteId) return setError("Elige un cliente (F2)");
    if (carrito.length === 0) return setError("Agrega al menos un producto");
    if (usaCaja && !sesion) return setError("La caja esta cerrada. Presiona F9 (o Ctrl+O) para abrirla.");
    if (soloVentas && esConsumidorFinal && carrito.some((l) => l.prestado) && !nombreCliente.trim())
      return setError("Escribe el nombre de quien se lleva el cilindro prestado");
    if (soloVentas && esConsumidorFinal && rncEscrito) {
      if (rncEscrito.length !== 9 && rncEscrito.length !== 11) return setError("El RNC tiene 9 numeros (empresa) o 11 (cedula). Revisalo.");
      if (!nombreCliente.trim()) return setError("Escribe el nombre de la empresa del RNC");
    }
    if (soloVentas && PIDEN_RNC.includes(tipoNcf) && !tieneRnc) return setError(`Para ${NCF_LABELS[tipoNcf]} hace falta el RNC del cliente`);
    setRecibido(calculo.total.toFixed(2));
    setPagando(true);
  }

  const montoRecibido = Number(recibido.replace(",", ".")) || 0;
  const devuelta = r2(montoRecibido - calculo.total);

  async function confirmarCobro(e?: React.FormEvent) {
    e?.preventDefault();
    if (cobrando) return;
    if (metodoPago === "EFECTIVO" && devuelta < 0) return;
    if (metodoPago === "FIADO" && esConsumidorFinal && !nombreCliente.trim()) return;
    setCobrando(true);
    try {
      let idCliente = clienteId as number;
      let fiadoA = cliente?.nombre;
      if (soloVentas && esConsumidorFinal && (rncEscrito || nombreCliente.trim())) {
        // Con nombre o RNC la persona queda registrada como cliente (para verla en el Admin y darle
        // credito fiscal despues): se usa el que ya tiene ese RNC o ese nombre, o se registra uno nuevo.
        const nombre = nombreCliente.trim();
        const existente = rncEscrito
          ? clientes.find((c) => (c.rnc_cedula ?? "").replace(/\D/g, "") === rncEscrito)
          : clientes.find((c) => c.codigo !== "CLI-0000" && c.activo !== 0 && sinAcentos(c.nombre.trim()) === sinAcentos(nombre));
        const elegido =
          existente ??
          ((await api.clientes.crear(
            rncEscrito
              ? { nombre, rnc_cedula: rncCliente.trim(), telefono: telefonoFiado.trim(), tipo: rncEscrito.length === 9 ? "JURIDICA" : "FISICA" }
              : { nombre, telefono: telefonoFiado.trim(), tipo: "FISICA" }
          )) as Cliente);
        if (!existente) setClientes((cs) => [...cs, elegido]);
        idCliente = elegido.id;
        fiadoA = elegido.nombre;
      }
      const factura = (await api.facturas.crear({
        cliente_id: idCliente,
        fecha: todayIso(),
        // fiado: la venta queda a credito (la caja no espera ese dinero) y se cobra despues en Fiados
        condicion_pago: metodoPago === "FIADO" ? "CREDITO" : "CONTADO",
        metodo_pago: metodoPago === "FIADO" ? undefined : metodoPago,
        tipo_ncf: soloVentas ? tipoNcf : "B02",
        codigos_ncf: VERSION_CODIGOS_NCF,
        creado_por: usuario?.nombre,
        caja_sesion_id: sesion?.id ?? null,
        lineas: carrito.map((l) => ({ producto_id: l.producto_id, modalidad: l.modalidad, cantidad: l.cantidad, precio_unitario: l.precio ?? productos.find((p) => p.id === l.producto_id)!.precio_contenido, descuento: 0, prestado: !!l.prestado })),
      })) as any;
      setPagando(false);
      const cfg = await api.impresion.obtenerConfig().catch(() => null);
      const auto = cfg?.formato === "TICKET" && cfg.imprimirAlCobrar;
      const pago = metodoPago === "EFECTIVO" ? { recibido: montoRecibido, devuelta } : null;
      setVenta({
        id: factura.id,
        ncf: factura.ncf,
        total: factura.total,
        devuelta: metodoPago === "EFECTIVO" ? devuelta : null,
        metodo: metodoPago,
        fiadoA: metodoPago === "FIADO" ? fiadoA : undefined,
        aviso: auto ? await (soloVentas ? imprimirFacturaGasDamian(factura.id, pago) : imprimirReciboFactura(factura.id, cfg!)) : null,
        impresoSolo: !!auto,
      });
      setCarrito([]);
      setLineaSel(-1);
      setNombreCliente("");
      setRncCliente("");
      setTipoElegido(null);
      setTelefonoFiado("");
      traerProductos(); // existencias y porciones al dia
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
    // Gas Damian: su recibo en la termica (o la hoja carta, segun la impresora configurada).
    const pago = venta.devuelta !== null ? { recibido: venta.total + venta.devuelta, devuelta: venta.devuelta } : null;
    const aviso = soloVentas ? await imprimirFacturaGasDamian(venta.id, pago) : await imprimirReciboFactura(venta.id);
    setVenta({ ...venta, aviso });
    setImprimiendo(false);
  }

  function cerrarVenta() {
    setVenta(null);
    nuevaVenta();
  }

  // ---------- teclado ----------
  const estado = useRef({ iniciarCobro, alternarModalidad, cambiarCantidad, quitar, lineaSel, busqueda, carrito, setMetodoPago });
  estado.current = { iniciarCobro, alternarModalidad, cambiarCantidad, quitar, lineaSel, busqueda, carrito, setMetodoPago };

  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => {
      if (hayModalAbierto() || e.defaultPrevented) return; // las ventanas (y las flechas generales) ya lo manejaron
      const s = estado.current;
      const ctrl = e.ctrlKey || e.metaKey;
      const seleccion = s.lineaSel >= 0 ? s.lineaSel : s.carrito.length - 1;
      const enOtroCampo = document.activeElement !== buscador.current && !!(document.activeElement as HTMLElement | null)?.closest("input, textarea, select");
      const metodo = metodoDeTecla(e);
      if (metodo) {
        e.preventDefault();
        s.setMetodoPago(metodo);
      } else if (e.key === "F12" || ((e.ctrlKey || e.metaKey) && e.key === "Enter")) {
        e.preventDefault();
        s.iniciarCobro();
      } else if (e.key === "F2" || (ctrl && e.key.toLowerCase() === "b")) {
        e.preventDefault();
        setTextoCliente("");
        setClienteSel(0);
        setEligiendoCliente(true);
      } else if (e.key === "F4" || (ctrl && e.key.toLowerCase() === "e")) {
        e.preventDefault();
        s.alternarModalidad(s.lineaSel >= 0 ? s.lineaSel : s.carrito.length - 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (s.busqueda) {
          setBusqueda("");
          enfocar();
        } else if (s.carrito.length) setConfirmarCancelar(true); // el foco va al boton "Si, cancelar"
      } else if (document.activeElement !== buscador.current && !enOtroCampo && !ctrl && !e.altKey) {
        // Con el foco fuera del buscador (por ejemplo despues de tocar un producto o una linea):
        // + - Supr y las flechas siguen actuando sobre el carrito, y escribir va al buscador.
        if ((e.key === "+" || e.key === "-") && s.carrito.length) {
          e.preventDefault();
          s.cambiarCantidad(seleccion, e.key === "+" ? 1 : -1);
          enfocar();
        } else if (e.key === "Delete" && s.carrito.length) {
          e.preventDefault();
          s.quitar(seleccion);
        } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && s.carrito.length) {
          e.preventDefault();
          setLineaSel(Math.max(0, Math.min(seleccion + (e.key === "ArrowDown" ? 1 : -1), s.carrito.length - 1)));
          enfocar();
        } else if (e.key.length === 1) {
          buscador.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, []);

  // F6 F7 F8 o Ctrl+1 Ctrl+2 Ctrl+3 (en laptops las F suelen necesitar la tecla Fn).
  function metodoDeTecla(e: KeyboardEvent | React.KeyboardEvent): Metodo | undefined {
    const porF = { F6: "EFECTIVO", F7: "TARJETA", F8: "TRANSFERENCIA" }[e.key] as Metodo | undefined;
    if (porF) return porF;
    if (e.ctrlKey || e.metaKey) return ({ "1": "EFECTIVO", "2": "TARJETA", "3": "TRANSFERENCIA", ...(soloVentas ? { "4": "FIADO" } : {}) } as Record<string, Metodo>)[e.key];
    return undefined;
  }

  function teclaBuscador(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.ctrlKey || e.metaKey) return; // Ctrl+Enter, Ctrl+1... los maneja la caja (cobrar, metodo)
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
    if (c.nombre !== "Consumidor Final") (setNombreCliente(""), setRncCliente(""));
    setEligiendoCliente(false);
    enfocar();
  }

  // Gas Damian: lo que se escribe al elegir cliente sirve como nombre de un Consumidor Final (ej. Jose),
  // sin crear el cliente. Es la ultima opcion de la lista.
  const nombreLibre = soloVentas ? textoCliente.trim() : "";
  const opcionesCliente = clientesFiltrados.length + (nombreLibre ? 1 : 0);
  function venderANombre() {
    const consumidorFinal = clientes.find((x) => x.nombre === "Consumidor Final");
    if (!consumidorFinal) return;
    setClienteId(consumidorFinal.id);
    setNombreCliente(nombreLibre);
    setEligiendoCliente(false);
    enfocar();
  }

  const cliente = clientes.find((c) => c.id === clienteId);
  const esConsumidorFinal = cliente?.nombre === "Consumidor Final";
  const rncEscrito = rncCliente.replace(/\D/g, "");
  // Gas Damian: con valor fiscal (B01) si a Consumidor Final se le escribio un RNC o si el cliente elegido tiene RNC
  const valorFiscal = soloVentas && (esConsumidorFinal ? rncEscrito.length > 0 : !!(cliente?.rnc_cedula ?? "").replace(/\D/g, ""));
  const rncCompleto = rncEscrito.length === 9 || rncEscrito.length === 11;
  const tieneRnc = esConsumidorFinal ? rncCompleto : !!(cliente?.rnc_cedula ?? "").replace(/\D/g, "");
  const tipoNcf: TipoNcfVenta = tipoElegido ?? (valorFiscal ? "B01" : "B02");
  // si el RNC ya esta registrado, el nombre de la empresa se pone solo
  function escribirRnc(texto: string) {
    setRncCliente(texto);
    const digitos = texto.replace(/\D/g, "");
    const conocido = (digitos.length === 9 || digitos.length === 11) && clientes.find((c) => (c.rnc_cedula ?? "").replace(/\D/g, "") === digitos);
    if (conocido) setNombreCliente(conocido.nombre);
  }
  const seleccionVisible = lineaSel >= 0 ? lineaSel : carrito.length - 1;
  const billetesRapidos = soloVentas
    ? // Gas Damian: "Exacto" y los billetes que alcanzan
      [calculo.total, ...[...new Set([Math.ceil(calculo.total / 500) * 500, Math.ceil(calculo.total / 1000) * 1000, Math.ceil(calculo.total / 2000) * 2000])].filter((v) => v > calculo.total)].slice(0, 4)
    : [...new Set([Math.ceil(calculo.total / 100) * 100, Math.ceil(calculo.total / 500) * 500, Math.ceil(calculo.total / 1000) * 1000, 2000])]
        .filter((v) => v > calculo.total)
        .slice(0, 3);

  return (
    <div className={`flex h-[calc(100vh-56px)] gap-5 ${esColmado ? "flex-col" : ""}`} data-nav-propio>
      {esColmado ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <CajaCerradaAviso />
          {avisoRecuperada && carrito.length > 0 && (
            <AvisoBorrador
              texto={`Se recupero la venta que estabas haciendo (${carrito.length} producto${carrito.length === 1 ? "" : "s"}).`}
              onOcultar={() => setAvisoRecuperada(false)}
              onDescartar={nuevaVenta}
            />
          )}
          {/* Encabezado de la factura */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-sm lg:grid-cols-[2fr_1fr_1fr_1fr]">
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                setTextoCliente("");
                setClienteSel(0);
                setEligiendoCliente(true);
              }}
              className="flex items-center justify-between bg-white px-4 py-2.5 text-left hover:bg-slate-50"
            >
              <span>
                <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Cliente</span>
                <span className="block text-base font-semibold text-slate-900">{cliente?.nombre === "Consumidor Final" ? "Contado" : cliente?.nombre ?? "Elegir cliente"}</span>
              </span>
              <span className="text-xs text-brand-600">
                Cambiar <Tecla>F2</Tecla>
              </span>
            </button>
            <div className="bg-white px-4 py-2.5">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Comprobante</span>
              <span className="block text-base font-semibold text-slate-900">B02 · Consumo</span>
            </div>
            <div className="bg-white px-4 py-2.5">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Factura</span>
              <span className="block text-base font-semibold text-slate-900">Nueva</span>
            </div>
            <div className="bg-white px-4 py-2.5">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">Fecha</span>
              <span className="block text-base font-semibold text-slate-900">{formatDate(todayIso())}</span>
              {sesion && <span className="text-[11px] font-medium text-emerald-700">{sesion.caja_nombre} abierta</span>}
            </div>
          </div>

          <TablaFactura
            productos={productos}
            lineas={calculo.lineas}
            entrada={buscador}
            texto={busqueda}
            setTexto={setBusqueda}
            agregar={(p, cantidad) => agregar(p, cantidad, false)}
            fijarCantidad={fijarCantidad}
            quitar={quitar}
            setError={setError}
            lineaSel={lineaSel}
            setLineaSel={setLineaSel}
          />

          {/* Pie: pago y totales */}
          <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex max-w-xl gap-1">
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
              {error && <p className="max-w-xl rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-600">{error}</p>}
              <p className="text-[11px] text-slate-400">
                Enter agregar · F3 o Ctrl+F buscar producto · ↑↓ cambiar cantidad · Supr quitar · F2 cliente (fiao) · F6-F8 pago · F12 cobrar · Esc cancelar · F1 ayuda
              </p>
            </div>
            <div className="w-72 space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span>{formatMoney(calculo.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>ITBIS</span>
                <span>{formatMoney(calculo.itbis)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-2xl font-bold text-slate-900">
                <span>Total</span>
                <span>{formatMoney(calculo.total)}</span>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="secondary" tabIndex={-1} onClick={() => carrito.length && setConfirmarCancelar(true)} disabled={carrito.length === 0}>
                  Cancelar <Tecla>Esc</Tecla>
                </Button>
                <Button className="flex-1" tabIndex={-1} onClick={iniciarCobro} disabled={cobrando || carrito.length === 0 || (usaCaja && !sesion)}>
                  Cobrar <Tecla>F12</Tecla>
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            <CajaCerradaAviso />
            {avisoRecuperada && carrito.length > 0 && (
              <AvisoBorrador
                texto={`Se recupero la venta que estabas haciendo (${carrito.length} producto${carrito.length === 1 ? "" : "s"}).`}
                onOcultar={() => setAvisoRecuperada(false)}
                onDescartar={nuevaVenta}
              />
            )}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h1 className="mr-1 text-xl font-semibold text-slate-900">Punto de venta</h1>
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
                {pestanas.map((c) => (
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

            <div className={`grid flex-1 auto-rows-max gap-3 overflow-y-auto pr-1 ${soloVentas ? "grid-cols-2 xl:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4"}`}>
              {resultados.map((p, i) => (
                <button
                  key={p.id}
                  tabIndex={-1}
                  onClick={() => agregar(p)}
                  disabled={p.existencia <= 0}
                  className={`flex flex-col items-start rounded-xl border bg-white text-left shadow-sm transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 ${
                    soloVentas ? `border-t-4 p-4 ${colorDe(grupoDe(p))}` : "p-3"
                  } ${busqueda.trim() && i === resaltado ? "border-brand-500 ring-2 ring-brand-200" : "border-slate-200"}`}
                >
                  <span className="flex w-full justify-between text-xs font-medium uppercase tracking-wide text-brand-600">
                    <span className="truncate">{usaGrupos ? grupoDe(p) : p.categoria}</span>
                    {/* en el colmado el codigo es el de barras (largo): no se muestra en la tarjeta */}
                    {!esColmado && !soloVentas && <span className="font-mono normal-case text-slate-400">{p.codigo}</span>}
                  </span>
                  <span className={`mt-1 font-semibold text-slate-800 ${soloVentas ? "text-base leading-snug" : "text-sm"}`}>{p.nombre}</span>
                  {/* en el colmado y en Gas Damian se ve el precio final, el que paga el cliente (con ITBIS) */}
                  <span className={`mt-1.5 font-bold text-slate-900 ${soloVentas ? "text-2xl" : "text-base"}`}>{formatMoney(esColmado || soloVentas ? p.precio_contenido * (1 + (p.itbis_rate ?? 0)) : p.precio_contenido)}</span>
                  <span className={`mt-1 text-xs ${p.existencia <= 0 && platosHoy.some((d) => d.producto_id === p.id) ? "font-bold text-red-600" : "text-slate-400"}`}>
                    {p.existencia <= 0 && platosHoy.some((d) => d.producto_id === p.id) ? "Agotado" : soloVentas ? `Quedan ${p.existencia}` : `Existencia: ${p.existencia}`}
                  </span>
                </button>
              ))}
              {resultados.length === 0 &&
                (categoria === "HOY" ? (
                  <div className="col-span-full py-10 text-center text-sm text-slate-500">
                    <p>Todavia no hay platos de hoy.</p>
                    <Button className="mt-3 py-2.5 text-base" onClick={() => navigate("/platos-dia")}>
                      Poner los platos de hoy
                    </Button>
                  </div>
                ) : (
                  <p className="col-span-full py-10 text-center text-sm text-slate-400">No hay productos que coincidan</p>
                ))}
            </div>
            <p className={`mt-2 text-[11px] text-slate-400 ${soloVentas ? "hidden" : ""}`}>
              ↑↓ elegir · Enter agregar · + / − cantidad · Supr quitar · F2 o Ctrl+B cliente · {manejaEnvases ? "F4 o Ctrl+E lleno/intercambio · " : ""}F6-F8 o Ctrl+1-3 pago · F12 o Ctrl+Enter cobrar · Esc cancelar · F1 ayuda
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
              className={`flex items-center justify-between border-b border-slate-200 text-left hover:bg-slate-50 ${soloVentas ? "px-4 py-2.5" : "p-4"}`}
            >
              <span>
                <span className="block text-xs text-slate-400">Cliente</span>
                <span className="block text-sm font-semibold text-slate-800">{cliente?.nombre ?? "Elegir cliente"}</span>
              </span>
              <span className="text-xs text-brand-600">
                Cambiar <Tecla>F2 · CtrlB</Tecla>
              </span>
            </button>
            {soloVentas && (
              <div className="space-y-1.5 border-b border-slate-200 px-4 py-2.5">
                {esConsumidorFinal ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-0.5 block text-xs font-medium text-slate-600">
                        Nombre <span className="font-normal text-slate-400">(si quiere)</span>
                      </span>
                      <input
                        value={nombreCliente}
                        onChange={(e) => setNombreCliente(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), enfocar())}
                        placeholder={rncEscrito ? "Empresa" : "Ej. Jose"}
                        className={CAMPO_CLIENTE}
                        data-nav-ignorar
                      />
                    </label>
                    <label className="block">
                      <span className="mb-0.5 block text-xs font-medium text-slate-600">
                        RNC <span className="font-normal text-slate-400">(si lo pide)</span>
                      </span>
                      <input
                        value={rncCliente}
                        onChange={(e) => escribirRnc(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), enfocar())}
                        placeholder="RNC"
                        inputMode="numeric"
                        className={CAMPO_CLIENTE}
                        data-nav-ignorar
                      />
                    </label>
                  </div>
                ) : (
                  <p className={`rounded-md px-2 py-1 text-xs font-medium ${valorFiscal ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600"}`}>
                    {valorFiscal ? `✓ Factura con RNC ${cliente?.rnc_cedula ?? ""}` : "Factura normal (sin RNC)"}
                  </p>
                )}
                <label className="flex items-center gap-2">
                  <span className="shrink-0 text-xs font-medium text-slate-600">Comprobante</span>
                  <select value={tipoNcf} onChange={(e) => setTipoElegido(e.target.value as TipoNcfVenta)} className={CAMPO_CLIENTE} data-nav-ignorar>
                    {TIPOS_NCF_VENTA.map((t) => (
                      <option key={t} value={t}>
                        {NCF_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                {esConsumidorFinal && rncEscrito && !rncCompleto && <p className="text-xs text-amber-700">El RNC tiene 9 numeros (o 11 si es cedula)</p>}
                {PIDEN_RNC.includes(tipoNcf) && !tieneRnc && !rncEscrito && <p className="text-xs text-amber-700">Este comprobante lleva el RNC del cliente</p>}
              </div>
            )}

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
                          <button tabIndex={-1} onClick={() => cambiarCantidad(i, -1)} className={`rounded bg-slate-200 font-bold text-slate-700 hover:bg-slate-300 ${soloVentas ? "h-9 w-9 text-lg" : "h-6 w-6 text-sm"}`}>
                            -
                          </button>
                          <span className={`w-8 text-center font-medium ${soloVentas ? "text-lg" : "text-sm"}`}>{l.cantidad}</span>
                          <button tabIndex={-1} onClick={() => cambiarCantidad(i, 1)} className={`rounded bg-slate-200 font-bold text-slate-700 hover:bg-slate-300 ${soloVentas ? "h-9 w-9 text-lg" : "h-6 w-6 text-sm"}`}>
                            +
                          </button>
                        </div>
                        <span className="text-sm font-semibold text-slate-900">{formatMoney(l.bruto + l.itbisLinea + l.fianzaLinea)}</span>
                      </div>
                      {esFritura &&
                        (cambiandoPrecio?.i === i ? (
                          <form
                            className="mt-2 flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                            onSubmit={(e) => (e.preventDefault(), guardarPrecio(i))}
                          >
                            <span className="text-xs text-slate-500">Precio RD$</span>
                            <input
                              autoFocus
                              inputMode="decimal"
                              onFocus={(e) => e.target.select()}
                              value={cambiandoPrecio.texto}
                              onChange={(e) => setCambiandoPrecio({ i, texto: e.target.value.replace(/[^0-9.,]/g, "") })}
                              className="w-24 rounded-lg border-2 border-brand-300 px-2 py-1 text-base font-semibold outline-none focus:border-brand-500"
                              data-nav-ignorar
                            />
                            <button type="submit" className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                              Listo
                            </button>
                          </form>
                        ) : (
                          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                            <button
                              tabIndex={-1}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCambiandoPrecio({ i, texto: String(Math.round((l.precio ?? l.producto.precio_contenido) * (1 + (l.producto.itbis_rate ?? 0.18)) * 100) / 100) });
                              }}
                              className="rounded-lg bg-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-300"
                            >
                              Cambiar precio
                            </button>
                            {l.precio !== undefined && (
                              <button tabIndex={-1} onClick={(e) => (e.stopPropagation(), elegirPrecio(i, undefined))} className="text-amber-700 hover:underline">
                                Normal: {formatMoney(l.producto.precio_contenido * (1 + (l.producto.itbis_rate ?? 0.18)))} ✕
                              </button>
                            )}
                          </div>
                        ))}
                      {soloVentas && leerPrecios(l.producto).length > 0 && (
                        // Gas Damian: cual de sus precios se cobra
                        <div className="mt-2 flex flex-wrap gap-1 text-[11px] font-medium">
                          {[{ nombre: "Normal", precio: undefined as number | undefined }, ...leerPrecios(l.producto)].map((op) => {
                            const elegido = op.precio === undefined ? l.precio === undefined : l.precio === op.precio;
                            const final = (op.precio ?? l.producto.precio_contenido) * (1 + (l.producto.itbis_rate ?? 0.18));
                            return (
                              <button
                                key={op.nombre}
                                tabIndex={-1}
                                onClick={(e) => (e.stopPropagation(), elegirPrecio(i, op.precio))}
                                className={`rounded-full px-2.5 py-1 ${elegido ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-600 hover:bg-slate-300"}`}
                              >
                                {op.nombre} {formatMoney(final)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {!!l.producto.maneja_envase && soloVentas && (
                        // Gas Damian: que pasa con el cilindro, con tres botones claros
                        <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] font-medium leading-tight">
                          {MODOS_CILINDRO.map((m) => (
                            <button
                              key={m.modo}
                              tabIndex={-1}
                              onClick={(e) => (e.stopPropagation(), elegirModo(i, m.modo))}
                              className={`rounded-lg px-1 py-1.5 ${modoDe(l) === m.modo ? m.color : "bg-slate-200 text-slate-600 hover:bg-slate-300"}`}
                            >
                              {m.texto}
                            </button>
                          ))}
                        </div>
                      )}
                      {!!l.producto.maneja_envase && !soloVentas && (
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
                <Button
                  className={`flex-1 ${soloVentas ? "!bg-emerald-600 py-3 text-lg hover:!bg-emerald-700" : ""}`}
                  onClick={iniciarCobro}
                  disabled={cobrando || carrito.length === 0 || (usaCaja && !sesion)}
                >
                  {soloVentas ? `Cobrar ${formatMoney(calculo.total)}` : "Cobrar"} <Tecla>F12 · Ctrl↵</Tecla>
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

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
            if (e.key === "ArrowDown") (e.preventDefault(), setClienteSel((s) => Math.min(s + 1, opcionesCliente - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setClienteSel((s) => Math.max(s - 1, 0)));
            else if (e.key === "Enter") (e.preventDefault(), clienteSel < clientesFiltrados.length ? elegirCliente(clientesFiltrados[clienteSel]) : nombreLibre && venderANombre());
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
          {nombreLibre && (
            <button
              type="button"
              onMouseEnter={() => setClienteSel(clientesFiltrados.length)}
              onClick={venderANombre}
              className={`mt-1 flex w-full justify-between rounded-lg border border-dashed px-3 py-2 text-left text-sm ${
                clienteSel === clientesFiltrados.length ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-300 text-slate-700"
              }`}
            >
              <span>
                Vender a <b>{nombreLibre}</b>
              </span>
              <span className="text-xs text-slate-400">Consumidor Final</span>
            </button>
          )}
          {clientesFiltrados.length === 0 && !nombreLibre && <p className="py-4 text-center text-sm text-slate-400">Ningun cliente coincide</p>}
        </div>
        <p className="mt-2 text-xs text-slate-400">↑ ↓ elegir · Enter confirmar · Esc volver</p>
      </Modal>

      {/* Cobrar (F12) */}
      <Modal open={pagando} onClose={() => (setPagando(false), enfocar())} title="Cobrar">
        <form
          onSubmit={confirmarCobro}
          className="space-y-4"
          onKeyDown={(e) => {
            const m = metodoDeTecla(e);
            if (m) {
              e.preventDefault();
              setMetodoPago(m);
            }
          }}
        >
          <div className="flex items-end justify-between">
            <span className="text-sm text-slate-500">Total a cobrar</span>
            <span className="text-3xl font-bold text-slate-900">{formatMoney(calculo.total)}</span>
          </div>
          <div
            className="flex gap-1"
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
            >
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">{soloVentas ? "¿Cuánto le dio el cliente?" : "Recibido del cliente"}</span>
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
                  <button
                    key={v}
                    type="button"
                    tabIndex={-1}
                    onClick={() => setRecibido(v.toFixed(2))}
                    className={`rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 ${soloVentas ? "flex-1 py-3 text-base font-semibold" : "px-3 py-1 text-sm"}`}
                  >
                    {soloVentas && v === calculo.total ? "Exacto" : formatMoney(v)}
                  </button>
                ))}
              </div>
              <div className={`flex items-end justify-between rounded-lg px-3 py-3 ${devuelta < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
                <span className="text-sm font-medium">{devuelta < 0 ? "Falta" : soloVentas ? "Devuélvale" : "Devuelta"}</span>
                <span className="text-3xl font-bold">{formatMoney(Math.abs(devuelta))}</span>
              </div>
            </div>
          ) : metodoPago === "FIADO" ? (
            <div className="space-y-2">
              {esConsumidorFinal ? (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">¿A quién se le fía?</span>
                    <input
                      autoFocus
                      className="w-full rounded-lg border-2 border-amber-300 px-3 py-2 text-lg font-semibold outline-none focus:border-amber-500"
                      placeholder="Nombre de la persona"
                      value={nombreCliente}
                      onChange={(e) => setNombreCliente(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">
                      Teléfono <span className="font-normal text-slate-400">(si quiere)</span>
                    </span>
                    <input
                      inputMode="tel"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base outline-none focus:border-amber-500"
                      value={telefonoFiado}
                      onChange={(e) => setTelefonoFiado(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  Se le fía a <b>{cliente?.nombre}</b>.
                </p>
              )}
              <div className="rounded-lg bg-amber-50 px-3 py-3 text-amber-800">
                <span className="block text-sm font-medium">Queda debiendo</span>
                <span className="block text-3xl font-bold">{formatMoney(calculo.total)}</span>
                <span className="block text-xs">No entra dinero a la caja ahora: lo paga después en Fiados.</span>
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">Confirma que el pago con {metodoPago === "TARJETA" ? "tarjeta" : "transferencia"} fue aprobado.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => (setPagando(false), enfocar())}>
              Volver <Tecla>Esc</Tecla>
            </Button>
            <Button
              type="submit"
              autoFocus={metodoPago !== "EFECTIVO" && metodoPago !== "FIADO"}
              disabled={cobrando || (metodoPago === "EFECTIVO" && devuelta < 0) || (metodoPago === "FIADO" && esConsumidorFinal && !nombreCliente.trim())}
            >
              {cobrando ? "Guardando..." : metodoPago === "FIADO" ? "Fiar" : "Confirmar cobro"} <Tecla>Enter</Tecla>
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
            {venta.metodo === "FIADO" && (
              <div className="rounded-lg bg-amber-50 px-4 py-4 text-amber-800">
                <span className="block text-sm font-medium">Fiado a {venta.fiadoA}</span>
                <span className="block text-4xl font-bold">{formatMoney(venta.total)}</span>
                <span className="block text-xs">Cuando pague, cóbrale en Fiados.</span>
              </div>
            )}
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
                  {imprimiendo ? "Imprimiendo..." : soloVentas ? "Imprimir factura" : "Imprimir recibo"} <Tecla>Enter</Tecla>
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
