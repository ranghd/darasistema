import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import type { Cliente, CompanyConfig, FacturaHistorial, FiltrosHistorial, ResumenCliente } from "../../lib/types";
import { firstDayOfMonthIso, formatDate, formatMoney, todayIso } from "../../lib/format";
import { descargarCsv, html, imprimirHtml } from "../../lib/exportar";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

interface EnvaseSaldo {
  producto_id: number;
  producto_nombre: string;
  cantidad: number;
  fianza_total: number;
}

type Periodo = "TODAS" | "HOY" | "MES" | "DIA" | "RANGO";
type Pestana = "HISTORIAL" | "PRODUCTOS" | "ENVASES";

const POR_PAGINA = 25;

const METODOS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  CHEQUE: "Cheque",
};

function metodoDe(f: FacturaHistorial): string {
  if (f.condicion_pago === "CREDITO") return "Credito";
  return METODOS[f.metodo_pago ?? "EFECTIVO"] ?? f.metodo_pago ?? "Efectivo";
}

function toneEstado(estado: string): "green" | "red" | "amber" {
  return estado === "PAGADA" ? "green" : estado === "ANULADA" ? "red" : "amber";
}

const descuentoDe = (f: FacturaHistorial) => f.lineas.reduce((s, l) => s + (l.descuento ?? 0), 0);

// ---------- impresion y exportacion ----------

function htmlFactura(f: FacturaHistorial, empresa: CompanyConfig | null): string {
  const descuento = descuentoDe(f);
  const filas = f.lineas
    .map(
      (l) => `<tr><td>${html(l.producto_nombre)}${l.modalidad === "LLENO" ? " (lleno)" : ""}</td><td class="r">${l.cantidad}</td>
        <td class="r">${formatMoney(l.precio_unitario)}</td><td class="r">${formatMoney(l.descuento)}</td>
        <td class="r">${formatMoney(l.itbis)}</td><td class="r">${formatMoney(l.subtotal)}</td></tr>`
    )
    .join("");
  const cobros = f.cobros.length
    ? `<p class="muted">Cobros: ${f.cobros.map((c) => `${formatDate(c.fecha)} ${METODOS[c.metodo] ?? c.metodo} ${formatMoney(c.monto)}`).join(" · ")}</p>`
    : "";
  return `<div class="doc">
    <div style="display:flex;justify-content:space-between">
      <div><h2>${html(empresa?.nombre_empresa ?? "")}</h2><div class="muted">${empresa?.rnc ? `RNC ${html(empresa.rnc)}` : ""}</div></div>
      <div style="text-align:right"><h2>Factura No. ${f.numero}</h2><div>NCF: ${html(f.ncf ?? "-")}</div><div>${formatDate(f.fecha)}</div></div>
    </div>
    <p>Cliente: <b>${html(f.cliente_nombre)}</b> · ${f.condicion_pago === "CONTADO" ? "Contado" : "Credito"} · Metodo: ${html(metodoDe(f))} ·
      Estado: ${f.estado}${f.creado_por ? ` · Atendido por: ${html(f.creado_por)}` : ""}</p>
    <table><thead><tr><th>Producto</th><th class="r">Cant.</th><th class="r">Precio</th><th class="r">Desc.</th><th class="r">ITBIS</th><th class="r">Subtotal</th></tr></thead>
      <tbody>${filas}</tbody></table>
    <div class="totales">
      <div><span>Subtotal</span><span>${formatMoney(f.subtotal + descuento)}</span></div>
      <div><span>Descuento</span><span>${formatMoney(descuento)}</span></div>
      <div><span>ITBIS</span><span>${formatMoney(f.itbis)}</span></div>
      ${f.fianza_total ? `<div><span>Fianza envases</span><span>${formatMoney(f.fianza_total)}</span></div>` : ""}
      <div class="fuerte"><span>Total</span><span>${formatMoney(f.total)}</span></div>
    </div>
    ${cobros}
    ${f.nota_credito_ncf ? `<p class="muted">Nota de credito: ${html(f.nota_credito_ncf)}</p>` : ""}
    ${f.nota_debito_ncf ? `<p class="muted">Nota de debito: ${html(f.nota_debito_ncf)}</p>` : ""}
  </div>`;
}

function exportarCsv(cliente: Cliente, facturas: FacturaHistorial[]) {
  const filas: unknown[][] = [];
  for (const f of facturas) {
    for (const l of f.lineas) {
      filas.push([
        f.fecha,
        f.numero,
        f.ncf ?? "",
        f.estado,
        f.condicion_pago === "CONTADO" ? "Contado" : "Credito",
        metodoDe(f),
        f.creado_por ?? "",
        l.producto_nombre,
        l.modalidad === "LLENO" ? "Lleno" : "Intercambio",
        l.cantidad,
        l.precio_unitario.toFixed(2),
        (l.descuento ?? 0).toFixed(2),
        l.itbis.toFixed(2),
        l.subtotal.toFixed(2),
        f.total.toFixed(2),
      ]);
    }
  }
  descargarCsv(
    `historial-${cliente.codigo}-${todayIso()}.csv`,
    ["Fecha", "Factura", "NCF", "Estado", "Condicion", "Metodo de pago", "Usuario", "Producto", "Modalidad", "Cantidad", "Precio", "Descuento", "ITBIS", "Subtotal linea", "Total factura"],
    filas
  );
}

// ---------- vista de detalle (una o varias compras) ----------

function DetalleCompra({ f }: { f: FacturaHistorial }) {
  const descuento = descuentoDe(f);
  const cobrado = f.cobros.reduce((s, c) => s + c.monto, 0);
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-slate-900">Factura #{String(f.numero).padStart(6, "0")}</p>
          <p className="font-mono text-xs text-slate-500">NCF {f.ncf ?? "-"}</p>
        </div>
        <Badge tone={toneEstado(f.estado)}>{f.estado}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <p>
          <span className="text-slate-400">Fecha: </span>
          {formatDate(f.fecha)}
        </p>
        <p>
          <span className="text-slate-400">Cliente: </span>
          {f.cliente_nombre}
        </p>
        <p>
          <span className="text-slate-400">Condicion: </span>
          {f.condicion_pago === "CONTADO" ? "Contado" : "Credito"}
        </p>
        <p>
          <span className="text-slate-400">Metodo de pago: </span>
          {metodoDe(f)}
        </p>
        <p>
          <span className="text-slate-400">Atendido por: </span>
          {f.creado_por || "-"}
        </p>
        <p>
          <span className="text-slate-400">Registrada: </span>
          {f.creado_en}
        </p>
      </div>

      <div className="mt-3">
        <Table columns={["Producto", "Modalidad", "Cant.", "Precio", "Descuento", "ITBIS", "Subtotal"]}>
          {f.lineas.map((l) => (
            <tr key={l.id}>
              <td className="px-4 py-2 font-medium text-slate-800">{l.producto_nombre}</td>
              <td className="px-4 py-2 text-xs text-slate-500">{l.modalidad === "LLENO" ? "Lleno" : "Intercambio"}</td>
              <td className="px-4 py-2">{l.cantidad}</td>
              <td className="px-4 py-2">{formatMoney(l.precio_unitario)}</td>
              <td className="px-4 py-2">{formatMoney(l.descuento)}</td>
              <td className="px-4 py-2">{formatMoney(l.itbis)}</td>
              <td className="px-4 py-2">{formatMoney(l.subtotal)}</td>
            </tr>
          ))}
        </Table>
      </div>

      <div className="mt-3 flex flex-wrap justify-between gap-4 text-sm">
        <div className="space-y-1 text-slate-600">
          {f.cobros.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">Cobros</p>
              {f.cobros.map((c) => (
                <p key={c.id}>
                  {formatDate(c.fecha)} · {METODOS[c.metodo] ?? c.metodo} · {formatMoney(c.monto)}
                </p>
              ))}
            </div>
          )}
          {f.nota_credito_ncf && <p>Nota de credito: <span className="font-mono">{f.nota_credito_ncf}</span></p>}
          {f.nota_debito_ncf && <p>Nota de debito: <span className="font-mono">{f.nota_debito_ncf}</span></p>}
        </div>
        <div className="w-64 space-y-0.5">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{formatMoney(f.subtotal + descuento)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Descuento</span>
            <span>{formatMoney(descuento)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>ITBIS</span>
            <span>{formatMoney(f.itbis)}</span>
          </div>
          {f.fianza_total > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Fianza por envases</span>
              <span>{formatMoney(f.fianza_total)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatMoney(f.total)}</span>
          </div>
          {f.condicion_pago === "CREDITO" && f.estado !== "ANULADA" && (
            <div className="flex justify-between text-amber-600">
              <span>Pendiente</span>
              <span>{formatMoney(f.total - cobrado)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- pagina ----------

export default function DetalleCliente() {
  const { id } = useParams();
  const clienteId = Number(id);
  const navigate = useNavigate();

  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [empresa, setEmpresa] = useState<CompanyConfig | null>(null);
  const [resumen, setResumen] = useState<ResumenCliente | null>(null);
  const [envases, setEnvases] = useState<EnvaseSaldo[]>([]);
  const [pestana, setPestana] = useState<Pestana>("HISTORIAL");

  // filtros
  const [periodo, setPeriodo] = useState<Periodo>("TODAS");
  const [dia, setDia] = useState(todayIso());
  const [desde, setDesde] = useState(firstDayOfMonthIso());
  const [hasta, setHasta] = useState(todayIso());
  const [textoBusqueda, setTextoBusqueda] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [productoId, setProductoId] = useState<number | "">("");
  const [metodo, setMetodo] = useState("");
  const [estado, setEstado] = useState<"" | "PENDIENTE" | "PAGADA" | "ANULADA">("");
  const [usuarioFiltro, setUsuarioFiltro] = useState("");

  // resultados
  const [filas, setFilas] = useState<FacturaHistorial[]>([]);
  const [total, setTotal] = useState(0);
  const [sumaTotal, setSumaTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(false);

  // seleccion y detalle
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [detalle, setDetalle] = useState<FacturaHistorial[] | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    if (!clienteId) return;
    api.clientes.obtener(clienteId).then((c) => setCliente((c as Cliente) ?? null));
    api.clientes.resumen(clienteId).then(setResumen);
    api.clientes.estadoCuenta(clienteId).then((r: any) => setEnvases(r.envases));
    api.config.obtener().then((c) => setEmpresa(c as CompanyConfig));
  }, [clienteId]);

  // La busqueda espera a que el usuario deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(textoBusqueda), 300);
    return () => clearTimeout(t);
  }, [textoBusqueda]);

  const filtros = useMemo((): FiltrosHistorial => {
    const f: FiltrosHistorial = {};
    if (periodo === "HOY") f.desde = f.hasta = todayIso();
    if (periodo === "MES") {
      f.desde = firstDayOfMonthIso();
      f.hasta = todayIso();
    }
    if (periodo === "DIA" && dia) f.desde = f.hasta = dia;
    if (periodo === "RANGO") {
      if (desde) f.desde = desde;
      if (hasta) f.hasta = hasta;
    }
    if (busqueda.trim()) f.busqueda = busqueda.trim();
    if (productoId) f.producto_id = productoId;
    if (metodo) f.metodo = metodo;
    if (estado) f.estado = estado;
    if (usuarioFiltro) f.usuario = usuarioFiltro;
    return f;
  }, [periodo, dia, desde, hasta, busqueda, productoId, metodo, estado, usuarioFiltro]);

  const hayFiltros = Object.keys(filtros).length > 0;

  async function cargarPagina(n: number) {
    setCargando(true);
    try {
      const r = await api.clientes.historial(clienteId, { ...filtros, pagina: n, porPagina: POR_PAGINA });
      setFilas((prev) => (n === 1 ? r.filas : [...prev, ...r.filas]));
      setTotal(r.total);
      setSumaTotal(r.sumaTotal);
      setPagina(n);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    if (clienteId) cargarPagina(1);
  }, [clienteId, filtros]);

  function verTodas() {
    setPeriodo("TODAS");
    setTextoBusqueda("");
    setBusqueda("");
    setProductoId("");
    setMetodo("");
    setEstado("");
    setUsuarioFiltro("");
    setPestana("HISTORIAL");
  }

  function alternar(idFactura: number) {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(idFactura)) s.delete(idFactura);
      else s.add(idFactura);
      return s;
    });
  }

  const todasVisiblesSeleccionadas = filas.length > 0 && filas.every((f) => seleccion.has(f.id));

  function alternarVisibles() {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (todasVisiblesSeleccionadas) filas.forEach((f) => s.delete(f.id));
      else filas.forEach((f) => s.add(f.id));
      return s;
    });
  }

  // Selecciona todas las compras que cumplen el filtro, no solo las cargadas en pantalla.
  async function seleccionarTodoElFiltro() {
    setTrabajando(true);
    try {
      const r = await api.clientes.historial(clienteId, { ...filtros, pagina: 1, porPagina: Math.max(total, 1) });
      setSeleccion(new Set(r.filas.map((f) => f.id)));
    } finally {
      setTrabajando(false);
    }
  }

  async function facturasSeleccionadas(): Promise<FacturaHistorial[]> {
    const ids = [...seleccion];
    const enPantalla = filas.filter((f) => seleccion.has(f.id));
    if (enPantalla.length === ids.length) return enPantalla;
    const r = await api.clientes.historial(clienteId, { ids, pagina: 1, porPagina: ids.length });
    return r.filas;
  }

  async function accion(tipo: "VER" | "IMPRIMIR" | "CSV") {
    if (!cliente || seleccion.size === 0) return;
    setTrabajando(true);
    try {
      const lista = await facturasSeleccionadas();
      if (tipo === "VER") setDetalle(lista);
      if (tipo === "IMPRIMIR") imprimirHtml(`Compras de ${cliente.nombre}`, encabezadoImpresion(lista) + lista.map((f) => htmlFactura(f, empresa)).join(""));
      if (tipo === "CSV") exportarCsv(cliente, lista);
    } finally {
      setTrabajando(false);
    }
  }

  function encabezadoImpresion(lista: FacturaHistorial[]): string {
    const suma = lista.filter((f) => f.estado !== "ANULADA").reduce((s, f) => s + f.total, 0);
    return `<h1>Historial de compras · ${html(cliente?.nombre)}</h1>
      <p class="muted">${lista.length} compra(s) · Total ${formatMoney(suma)} · Impreso el ${formatDate(todayIso())}</p>`;
  }

  if (!cliente) return <p className="text-sm text-slate-400">Cargando...</p>;

  const pestanas: [Pestana, string][] = [
    ["HISTORIAL", "Historial"],
    ["PRODUCTOS", `Productos comprados${resumen ? ` (${resumen.productos.length})` : ""}`],
    ["ENVASES", `Envases${envases.length ? ` (${envases.length})` : ""}`],
  ];

  return (
    <div>
      <PageHeader
        title={cliente.nombre}
        subtitle={`Codigo ${cliente.codigo} · ${cliente.tipo === "JURIDICA" ? "Persona Juridica" : "Persona Fisica"} · ${cliente.rnc_cedula ?? "sin RNC/cedula"}`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={verTodas}>
              Ver todas las compras
            </Button>
            <Button variant="secondary" onClick={() => navigate("/clientes")}>
              Volver
            </Button>
          </div>
        }
      />

      {/* Resumen calculado de las facturas reales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Compras realizadas</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{resumen?.compras ?? 0}</p>
          {!!resumen?.anuladas && <p className="text-xs text-slate-400">+ {resumen.anuladas} anulada(s)</p>}
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Total gastado</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{formatMoney(resumen?.total_gastado)}</p>
          <p className="text-xs text-slate-400">Promedio por compra {formatMoney(resumen?.ticket_promedio)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Saldo pendiente</p>
          <p className={`mt-1 text-xl font-semibold ${resumen?.saldo_pendiente ? "text-amber-600" : "text-slate-900"}`}>{formatMoney(resumen?.saldo_pendiente)}</p>
          <p className="text-xs text-slate-400">{resumen?.facturas_pendientes ?? 0} factura(s) a credito pendiente(s)</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Primera / ultima compra</p>
          <p className="mt-1 text-sm font-medium text-slate-800">{resumen?.primera_compra ? formatDate(resumen.primera_compra) : "-"}</p>
          <p className="text-sm font-medium text-slate-800">{resumen?.ultima_compra ? formatDate(resumen.ultima_compra) : "-"}</p>
        </Card>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Contacto: {cliente.telefono || "sin telefono"} · {cliente.direccion || "sin direccion"}
        {cliente.email ? ` · ${cliente.email}` : ""}
      </p>

      <div className="mb-4 mt-6 flex gap-1 border-b border-slate-200">
        {pestanas.map(([valor, etiqueta]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setPestana(valor)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${pestana === valor ? "border-brand-600 font-semibold text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {pestana === "HISTORIAL" && (
        <div>
          {/* Filtros */}
          <div className="mb-3 space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[16rem] flex-1">
                <Input
                  label="Buscar"
                  placeholder="NCF, numero de factura, producto o usuario"
                  value={textoBusqueda}
                  onChange={(e) => setTextoBusqueda(e.target.value)}
                />
              </div>
              <div className="w-44">
                <Select label="Fecha" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
                  <option value="TODAS">Todas las fechas</option>
                  <option value="HOY">Hoy</option>
                  <option value="MES">Este mes</option>
                  <option value="DIA">Fecha especifica</option>
                  <option value="RANGO">Rango (desde / hasta)</option>
                </Select>
              </div>
              {periodo === "DIA" && (
                <div className="w-40">
                  <Input label="Dia" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
                </div>
              )}
              {periodo === "RANGO" && (
                <>
                  <div className="w-40">
                    <Input label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
                  </div>
                  <div className="w-40">
                    <Input label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-60">
                <Select label="Producto" value={productoId} onChange={(e) => setProductoId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Todos los productos</option>
                  {resumen?.productos.map((p) => (
                    <option key={p.producto_id} value={p.producto_id}>
                      {p.producto_nombre}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-44">
                <Select label="Metodo de pago" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                  <option value="">Todos</option>
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                  <option value="CREDITO">Credito</option>
                </Select>
              </div>
              <div className="w-40">
                <Select label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as any)}>
                  <option value="">Todos</option>
                  <option value="PAGADA">Pagada</option>
                  <option value="PENDIENTE">Pendiente</option>
                  <option value="ANULADA">Anulada</option>
                </Select>
              </div>
              <div className="w-48">
                <Select label="Usuario / empleado" value={usuarioFiltro} onChange={(e) => setUsuarioFiltro(e.target.value)}>
                  <option value="">Todos</option>
                  {resumen?.usuarios.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </div>
              {hayFiltros && (
                <Button variant="ghost" size="sm" onClick={verTodas}>
                  Limpiar filtros
                </Button>
              )}
            </div>
          </div>

          {/* Barra de resultados y acciones sobre la seleccion */}
          <div className="mb-2 flex min-h-[2.25rem] flex-wrap items-center gap-3 text-sm">
            {seleccion.size === 0 ? (
              <span className="text-slate-500">
                {total} compra(s){hayFiltros ? " con estos filtros" : ""} · Total {formatMoney(sumaTotal)}
                <span className="text-xs text-slate-400"> (sin contar anuladas)</span>
              </span>
            ) : (
              <>
                <span className="font-medium text-slate-800">{seleccion.size} seleccionada(s)</span>
                <Button size="sm" onClick={() => accion("VER")} disabled={trabajando}>
                  Ver detalles
                </Button>
                <Button size="sm" variant="secondary" onClick={() => accion("IMPRIMIR")} disabled={trabajando}>
                  Imprimir
                </Button>
                <Button size="sm" variant="secondary" onClick={() => accion("CSV")} disabled={trabajando}>
                  Exportar a Excel (CSV)
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSeleccion(new Set())}>
                  Quitar seleccion
                </Button>
              </>
            )}
          </div>
          {todasVisiblesSeleccionadas && total > filas.length && seleccion.size < total && (
            <p className="mb-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
              Seleccionaste las {filas.length} compras cargadas.{" "}
              <button type="button" className="font-semibold underline" onClick={seleccionarTodoElFiltro} disabled={trabajando}>
                Seleccionar las {total} compras{hayFiltros ? " del filtro" : ""}
              </button>
            </p>
          )}

          <Table columns={["", "Fecha", "Factura", "Productos", "Desc.", "ITBIS", "Total", "Metodo", "Estado", "Usuario"]}>
            {filas.length === 0 && <EmptyRow colSpan={10} label={cargando ? "Cargando..." : hayFiltros ? "Ninguna compra coincide con los filtros" : "Este cliente todavia no tiene compras"} />}
            {filas.map((f) => (
              <tr key={f.id} onClick={() => setDetalle([f])} className={`cursor-pointer align-top hover:bg-slate-50 ${seleccion.has(f.id) ? "bg-brand-50/60" : ""}`}>
                <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={seleccion.has(f.id)} onChange={() => alternar(f.id)} aria-label={`Seleccionar factura ${f.numero}`} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDate(f.fecha)}</td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <p className="font-medium text-slate-800">#{String(f.numero).padStart(6, "0")}</p>
                  <p className="font-mono text-[11px] text-slate-400">{f.ncf ?? "-"}</p>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-600">
                  {f.lineas.map((l) => (
                    <p key={l.id}>
                      <span className="font-medium text-slate-800">{l.cantidad} ×</span> {l.producto_nombre} <span className="text-slate-400">@ {formatMoney(l.precio_unitario)}</span>
                    </p>
                  ))}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs">{descuentoDe(f) ? formatMoney(descuentoDe(f)) : "-"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs">{formatMoney(f.itbis)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-900">{formatMoney(f.total)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs">{metodoDe(f)}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={toneEstado(f.estado)}>{f.estado}</Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{f.creado_por || "-"}</td>
              </tr>
            ))}
          </Table>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={todasVisiblesSeleccionadas} onChange={alternarVisibles} disabled={filas.length === 0} />
              Seleccionar todo
            </label>
            <span>
              Mostrando {filas.length} de {total}
            </span>
            {filas.length < total ? (
              <Button size="sm" variant="secondary" onClick={() => cargarPagina(pagina + 1)} disabled={cargando}>
                {cargando ? "Cargando..." : `Cargar mas (${Math.min(POR_PAGINA, total - filas.length)})`}
              </Button>
            ) : (
              <span />
            )}
          </div>
        </div>
      )}

      {pestana === "PRODUCTOS" && (
        <Table columns={["Producto", "Veces comprado", "Cantidad total", "Monto (sin ITBIS)", "Ultima compra", ""]}>
          {(resumen?.productos.length ?? 0) === 0 && <EmptyRow colSpan={6} label="Todavia no ha comprado productos" />}
          {resumen?.productos.map((p) => (
            <tr key={p.producto_id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 font-medium text-slate-800">{p.producto_nombre}</td>
              <td className="px-4 py-2.5">{p.veces}</td>
              <td className="px-4 py-2.5">{p.cantidad}</td>
              <td className="px-4 py-2.5">{formatMoney(p.monto)}</td>
              <td className="px-4 py-2.5">{formatDate(p.ultima_fecha)}</td>
              <td className="px-4 py-2.5 text-right">
                <button
                  type="button"
                  className="text-xs font-medium text-brand-600 hover:underline"
                  onClick={() => {
                    verTodas();
                    setProductoId(p.producto_id);
                  }}
                >
                  Ver compras
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {pestana === "ENVASES" && (
        <Table columns={["Producto", "Cantidad", "Fianza retenida"]}>
          {envases.length === 0 && <EmptyRow colSpan={3} label="No tiene envases pendientes de devolver" />}
          {envases.map((e) => (
            <tr key={e.producto_id}>
              <td className="px-4 py-2.5">{e.producto_nombre}</td>
              <td className="px-4 py-2.5">{e.cantidad}</td>
              <td className="px-4 py-2.5">{formatMoney(e.fianza_total)}</td>
            </tr>
          ))}
        </Table>
      )}

      <Modal
        open={!!detalle}
        onClose={() => setDetalle(null)}
        title={detalle && detalle.length === 1 ? `Factura #${String(detalle[0].numero).padStart(6, "0")}` : `${detalle?.length ?? 0} compras seleccionadas`}
        width="max-w-4xl"
      >
        {detalle && (
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => imprimirHtml(`Compras de ${cliente.nombre}`, (detalle.length > 1 ? encabezadoImpresion(detalle) : "") + detalle.map((f) => htmlFactura(f, empresa)).join(""))}>
                Imprimir
              </Button>
              <Button size="sm" variant="secondary" onClick={() => exportarCsv(cliente, detalle)}>
                Exportar a Excel (CSV)
              </Button>
              {detalle.length === 1 && (
                <Button size="sm" variant="secondary" onClick={() => navigate(`/facturas/${detalle[0].id}`)}>
                  Abrir factura (cobros, notas, anular)
                </Button>
              )}
              {detalle.length > 1 && (
                <span className="self-center text-sm text-slate-500">
                  Total: <b>{formatMoney(detalle.filter((f) => f.estado !== "ANULADA").reduce((s, f) => s + f.total, 0))}</b>
                </span>
              )}
            </div>
            <div className="space-y-3">
              {detalle.map((f) => (
                <DetalleCompra key={f.id} f={f} />
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
