import { useEffect, useMemo, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { descargarCsv, imprimirTabla } from "../../lib/exportar";
import { TIPOS_DGII_606, type Banco, type Gasto, type ProveedorConResumen, type ResumenGastoTipo, type TipoGasto } from "../../lib/types";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";
import { BotonesExportar, RangoFechas, rangoDe } from "../../components/reportes";
import PagoSuplidorModal, { type DocumentoPorPagar } from "../../components/PagoSuplidor";

const num = (t: string) => Number(String(t).replace(/,/g, "")) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const tonoEstado = (e: string) => (e === "PAGADA" ? "green" : e === "ANULADA" ? "red" : "amber");
const nombreEstado = (e: string) => (e === "PAGADA" ? "Pagada" : e === "ANULADA" ? "Anulada" : "Por pagar");
// "02 - Gastos por trabajos, suministros y servicios"
const nombreDgii = (c?: string | null) => (c ? `${c} - ${TIPOS_DGII_606.find(([x]) => x === c)?.[1] ?? ""}` : "");

function SelectDgii({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`rounded-lg border border-slate-300 px-2 py-1.5 text-sm ${className}`}>
      {TIPOS_DGII_606.map(([c, n]) => (
        <option key={c} value={c}>
          {c} - {n}
        </option>
      ))}
    </select>
  );
}

export default function Gastos() {
  const [rango, setRango] = useState(rangoDe("MES"));
  const [tipoFiltro, setTipoFiltro] = useState<number | "">("");
  const [estadoFiltro, setEstadoFiltro] = useState("");
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [resumen, setResumen] = useState<ResumenGastoTipo[]>([]);
  const [tipos, setTipos] = useState<TipoGasto[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [verTipos, setVerTipos] = useState(false);
  const [pagar, setPagar] = useState<DocumentoPorPagar | null>(null);
  const [anular, setAnular] = useState<Gasto | null>(null);
  const [empresa, setEmpresa] = useState("");

  async function cargar() {
    const [g, r, t] = await Promise.all([
      api.gastos.listar({ desde: rango.desde, hasta: rango.hasta, tipo_gasto_id: tipoFiltro || undefined, estado: estadoFiltro || undefined }),
      api.gastos.resumenPorTipo(rango.desde, rango.hasta),
      api.tiposGasto.listar(),
    ]);
    setGastos(g);
    setResumen(r);
    setTipos(t);
  }
  useEffect(() => {
    cargar();
  }, [rango.desde, rango.hasta, tipoFiltro, estadoFiltro]);
  useEffect(() => {
    api.config.obtener().then((c: any) => setEmpresa(c?.nombre_empresa ?? ""));
  }, []);

  const validos = gastos.filter((g) => g.estado !== "ANULADA");
  const total = r2(validos.reduce((s, g) => s + g.total, 0));
  const itbis = r2(validos.reduce((s, g) => s + g.itbis, 0));
  const porPagar = r2(validos.reduce((s, g) => s + (g.saldo ?? 0), 0));
  const totalResumen = resumen.reduce((s, x) => s + x.total, 0);

  function exportar(imprimir: boolean) {
    const enc = ["No.", "Fecha", "Suplidor", "RNC", "NCF", "Tipo de gasto", "Tipo DGII (606)", "Concepto", "Monto", "ITBIS", "Total", "Condicion", "Estado", "Debe"];
    const filas = gastos.map((g) => [g.numero, g.fecha, g.suplidor, g.rnc ?? "", g.ncf ?? "", g.tipo_nombre ?? "", nombreDgii(g.tipo_dgii), g.concepto ?? "", g.subtotal, g.itbis, g.total, g.condicion_pago === "CONTADO" ? "Contado" : "Credito", nombreEstado(g.estado), g.saldo ?? 0]);
    if (!imprimir) return descargarCsv(`gastos-${rango.desde}-a-${rango.hasta}.csv`, enc, filas);
    imprimirTabla({
      titulo: "Gastos y facturas de suplidores",
      subtitulo: `Del ${formatDate(rango.desde)} al ${formatDate(rango.hasta)}`,
      empresa,
      encabezados: ["No.", "Fecha", "Suplidor", "NCF", "Tipo", "DGII", "Monto", "ITBIS", "Total", "Estado"],
      derecha: [6, 7, 8],
      filas: gastos.map((g) => [g.numero, formatDate(g.fecha), g.suplidor, g.ncf ?? "", g.tipo_nombre ?? "", g.tipo_dgii ?? "", formatMoney(g.subtotal), formatMoney(g.itbis), formatMoney(g.total), nombreEstado(g.estado)]),
      pie: ["", "", "", "", "", "TOTAL", formatMoney(validos.reduce((s, g) => s + g.subtotal, 0)), formatMoney(itbis), formatMoney(total), ""],
      resumen: resumen.map((x) => [x.nombre, formatMoney(x.total)]),
    });
  }

  return (
    <div>
      <PageHeader
        title="Gastos"
        subtitle="Facturas de suplidores que no son mercancia: combustible, taller, luz, alquiler..."
        actions={
          <>
            <BotonesExportar onExcel={() => exportar(false)} onImprimir={() => exportar(true)} />
            <Button variant="secondary" onClick={() => setVerTipos(true)}>
              Tipos de gasto
            </Button>
            <Button onClick={() => setNuevo(true)}>+ Registrar factura de suplidor</Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <RangoFechas desde={rango.desde} hasta={rango.hasta} onChange={setRango} />
        <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value ? Number(e.target.value) : "")} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
          <option value="">Todos los tipos</option>
          {tipos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
        <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
          <option value="">Todos</option>
          <option value="PENDIENTE">Por pagar</option>
          <option value="PAGADA">Pagadas</option>
          <option value="ANULADA">Anuladas</option>
        </select>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total gastado</p>
          <p className="mt-1.5 text-2xl font-semibold text-slate-900">{formatMoney(total)}</p>
          <p className="mt-1 text-xs text-slate-400">
            {validos.length} facturas · ITBIS pagado {formatMoney(itbis)}
          </p>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">Por pagar de estas facturas</p>
          <p className={`mt-1 text-xl font-semibold ${porPagar > 0 ? "text-amber-600" : "text-slate-900"}`}>{formatMoney(porPagar)}</p>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <p className="mb-3 text-sm font-semibold text-slate-700">Gastos por tipo</p>
          {resumen.length === 0 && <p className="text-sm text-slate-400">No hay gastos en este periodo</p>}
          <div className="space-y-2">
            {resumen.map((x) => (
              <button key={x.tipo_gasto_id} type="button" onClick={() => setTipoFiltro(tipoFiltro === x.tipo_gasto_id ? "" : x.tipo_gasto_id)} className="block w-full text-left">
                <div className="flex justify-between text-sm">
                  <span className={tipoFiltro === x.tipo_gasto_id ? "font-semibold text-brand-700" : "text-slate-700"}>
                    {x.nombre} <span className="text-xs text-slate-400">({x.cantidad})</span>
                  </span>
                  <span className="font-medium">{formatMoney(x.total)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${totalResumen ? (x.total / totalResumen) * 100 : 0}%` }} />
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Table columns={["No.", "Fecha", "Suplidor", "NCF", "Tipo de gasto", "Tipo DGII (606)", "Total", "Estado", ""]}>
        {gastos.length === 0 && <EmptyRow colSpan={9} label="No hay gastos registrados en este periodo" />}
        {gastos.map((g) => (
          <tr key={g.id} className={g.estado === "ANULADA" ? "opacity-50" : ""}>
            <td className="px-4 py-2 font-mono text-xs">{g.numero}</td>
            <td className="px-4 py-2">{formatDate(g.fecha)}</td>
            <td className="px-4 py-2">
              <span className="font-medium text-slate-800">{g.suplidor}</span>
              {g.concepto && <span className="block text-xs text-slate-400">{g.concepto}</span>}
            </td>
            <td className="px-4 py-2 font-mono text-xs">{g.ncf ?? "-"}</td>
            <td className="px-4 py-2 text-slate-600">{g.tipo_nombre}</td>
            <td className="px-4 py-2" title={nombreDgii(g.tipo_dgii)}>
              {/* Se puede corregir aqui mismo, sin anular la factura */}
              {g.estado === "ANULADA" ? (
                <span className="font-mono text-xs">{g.tipo_dgii ?? "-"}</span>
              ) : (
                <SelectDgii value={g.tipo_dgii ?? "02"} onChange={(v) => api.gastos.cambiarTipoDgii(g.id, v).then(cargar)} className="w-28 text-xs" />
              )}
            </td>
            <td className="px-4 py-2 text-right font-semibold">
              {formatMoney(g.total)}
              {g.itbis > 0 && <span className="block text-xs font-normal text-slate-400">ITBIS {formatMoney(g.itbis)}</span>}
            </td>
            <td className="px-4 py-2">
              <Badge tone={tonoEstado(g.estado)}>{nombreEstado(g.estado)}</Badge>
              {g.estado === "PENDIENTE" && <span className="block text-xs text-amber-600">debe {formatMoney(g.saldo)}</span>}
            </td>
            <td className="whitespace-nowrap px-4 py-2 text-right">
              {g.estado === "PENDIENTE" && (
                <Button size="sm" onClick={() => setPagar({ origen: "GASTO", id: g.id, numero: g.numero, suplidor: g.suplidor, ncf: g.ncf, saldo: g.saldo ?? g.total })}>
                  Pagar
                </Button>
              )}
              {g.estado !== "ANULADA" && (
                <button className="ml-2 text-xs text-red-500 hover:underline" onClick={() => setAnular(g)}>
                  Anular
                </button>
              )}
            </td>
          </tr>
        ))}
      </Table>

      <NuevoGastoModal open={nuevo} tipos={tipos.filter((t) => t.activo)} onClose={() => setNuevo(false)} onGuardado={cargar} onTiposCambiados={cargar} />
      <TiposGastoModal open={verTipos} tipos={tipos} onClose={() => setVerTipos(false)} onCambio={cargar} />
      <PagoSuplidorModal doc={pagar} onClose={() => setPagar(null)} onPagado={cargar} />
      <AnularGastoModal gasto={anular} onClose={() => setAnular(null)} onAnulado={cargar} />
    </div>
  );
}

function NuevoGastoModal({ open, tipos, onClose, onGuardado, onTiposCambiados }: { open: boolean; tipos: TipoGasto[]; onClose: () => void; onGuardado: () => void; onTiposCambiados: () => void }) {
  const { usuario } = useAuth();
  const [proveedores, setProveedores] = useState<ProveedorConResumen[]>([]);
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [f, setF] = useState({ suplidor: "", rnc: "", ncf: "", tipo: "" as number | "", dgii: "", fecha: todayIso(), concepto: "", subtotal: "", itbis: "", condicion: "CONTADO", metodo: "EFECTIVO", banco: "" as number | "", referencia: "", vence: "" });
  const [tipoNuevo, setTipoNuevo] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setF({ suplidor: "", rnc: "", ncf: "", tipo: "", dgii: "", fecha: todayIso(), concepto: "", subtotal: "", itbis: "", condicion: "CONTADO", metodo: "EFECTIVO", banco: "", referencia: "", vence: "" });
    setError("");
    setTipoNuevo("");
    api.proveedores.listar().then(setProveedores);
    api.bancos.listar().then((b) => {
      setBancos(b.filter((x) => x.activo));
      set("banco", b[0]?.id ?? "");
    });
  }, [open]);

  const proveedor = useMemo(() => proveedores.find((p) => p.nombre.toLowerCase() === f.suplidor.trim().toLowerCase()), [proveedores, f.suplidor]);
  useEffect(() => {
    if (proveedor?.rnc && !f.rnc) set("rnc", proveedor.rnc);
  }, [proveedor?.id]);
  const total = r2(num(f.subtotal) + num(f.itbis));

  async function crearTipo() {
    if (!tipoNuevo.trim()) return;
    try {
      const t = await api.tiposGasto.crear({ nombre: tipoNuevo });
      onTiposCambiados();
      set("tipo", t.id);
      setTipoNuevo("");
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!f.tipo) return setError("Elige el tipo de gasto");
    setGuardando(true);
    try {
      await api.gastos.crear({
        fecha: f.fecha,
        vence: f.condicion === "CREDITO" ? f.vence || null : null,
        proveedor_id: proveedor?.id ?? null,
        suplidor: f.suplidor,
        rnc: f.rnc,
        ncf: f.ncf,
        tipo_gasto_id: Number(f.tipo),
        tipo_dgii: f.dgii || null,
        concepto: f.concepto,
        subtotal: num(f.subtotal),
        itbis: num(f.itbis),
        condicion_pago: f.condicion as any,
        metodo: f.metodo as any,
        banco_id: f.metodo === "EFECTIVO" ? null : f.banco || null,
        referencia: f.referencia,
        creado_por: usuario?.nombre,
      });
      onGuardado();
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar factura de suplidor" width="max-w-2xl">
      <form onSubmit={guardar} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Input label="Suplidor" list="lista-suplidores" value={f.suplidor} onChange={(e) => set("suplidor", e.target.value)} placeholder="Ej. Estacion Shell Las Americas" autoFocus required />
            <datalist id="lista-suplidores">
              {proveedores.map((p) => (
                <option key={p.id} value={p.nombre} />
              ))}
            </datalist>
            {f.suplidor.trim() && !proveedor && <span className="text-xs text-slate-400">Suplidor nuevo: se guarda solo.</span>}
          </div>
          <Input label="RNC o cedula" value={f.rnc} onChange={(e) => set("rnc", e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input label="NCF de la factura" value={f.ncf} onChange={(e) => set("ncf", e.target.value.toUpperCase())} placeholder="B0100000123" />
          <Input label="Fecha de la factura" type="date" value={f.fecha} onChange={(e) => set("fecha", e.target.value)} />
          <Select
            label="Tipo de gasto"
            value={f.tipo}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : "";
              set("tipo", id);
              // el tipo DGII (606) se pone solo segun el tipo de gasto; se puede cambiar abajo
              set("dgii", tipos.find((t) => t.id === id)?.tipo_dgii ?? "02");
            }}
          >
            <option value="">Elegir...</option>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <Input label="¿No esta el tipo? Crealo aqui" value={tipoNuevo} onChange={(e) => setTipoNuevo(e.target.value)} placeholder="Ej. Seguro de vehiculos" />
          <Button type="button" variant="secondary" onClick={crearTipo} disabled={!tipoNuevo.trim()}>
            Agregar tipo
          </Button>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Tipo de bienes y servicios (DGII, formato 606)</span>
          <SelectDgii value={f.dgii || "02"} onChange={(v) => set("dgii", v)} className="w-full py-2" />
        </label>
        <Input label="Concepto (que se compro o que se hizo)" value={f.concepto} onChange={(e) => set("concepto", e.target.value)} placeholder="Ej. Cambio de frenos camion placa L123456" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input label="Monto sin ITBIS (RD$)" inputMode="decimal" value={f.subtotal} onChange={(e) => set("subtotal", e.target.value)} required />
          <div>
            <Input label="ITBIS (RD$)" inputMode="decimal" value={f.itbis} onChange={(e) => set("itbis", e.target.value)} placeholder="0.00" />
            <button type="button" className="mt-1 text-xs font-medium text-brand-600 hover:underline" onClick={() => set("itbis", String(r2(num(f.subtotal) * 0.18)))}>
              Calcular 18%
            </button>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <span className="block text-sm font-medium text-slate-700">Total</span>
            <span className="text-xl font-semibold">{formatMoney(total)}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="¿Como se pago?" value={f.condicion} onChange={(e) => set("condicion", e.target.value)}>
            <option value="CONTADO">Ya se pago (contado)</option>
            <option value="CREDITO">A credito (queda por pagar)</option>
          </Select>
          {f.condicion === "CONTADO" ? (
            <>
              <Select label="Forma de pago" value={f.metodo} onChange={(e) => set("metodo", e.target.value)}>
                <option value="EFECTIVO">Efectivo</option>
                <option value="TRANSFERENCIA">Transferencia</option>
                <option value="CHEQUE">Cheque</option>
                <option value="TARJETA">Tarjeta</option>
              </Select>
              {f.metodo !== "EFECTIVO" && (
                <Select label="Banco" value={f.banco} onChange={(e) => set("banco", Number(e.target.value))}>
                  {bancos.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre}
                    </option>
                  ))}
                </Select>
              )}
            </>
          ) : (
            <Input label="Fecha en que vence (opcional)" type="date" value={f.vence} onChange={(e) => set("vence", e.target.value)} />
          )}
        </div>
        {f.condicion === "CONTADO" && f.metodo !== "EFECTIVO" && <Input label="Referencia o numero de cheque" value={f.referencia} onChange={(e) => set("referencia", e.target.value)} />}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={guardando}>
            {guardando ? "Guardando..." : `Guardar ${total ? formatMoney(total) : ""}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TiposGastoModal({ open, tipos, onClose, onCambio }: { open: boolean; tipos: TipoGasto[]; onClose: () => void; onCambio: () => void }) {
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.tiposGasto.crear({ nombre });
      setNombre("");
      onCambio();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }
  async function alternar(t: TipoGasto) {
    await api.tiposGasto.actualizar(t.id, { activo: t.activo ? 0 : 1 });
    onCambio();
  }
  return (
    <Modal open={open} onClose={onClose} title="Tipos de gasto" width="max-w-2xl">
      <p className="mb-3 text-sm text-slate-500">Cada tipo de gasto va a su propia cuenta en la contabilidad. Al crear uno nuevo, el sistema le crea su cuenta.</p>
      <form onSubmit={crear} className="mb-4 flex items-end gap-2">
        <Input label="Nuevo tipo de gasto" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Seguro de vehiculos" />
        <Button type="submit" disabled={!nombre.trim()}>
          Agregar
        </Button>
      </form>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      <Table columns={["Tipo de gasto", "Cuenta contable", "DGII (606) por defecto", "Usos", ""]}>
        {tipos.map((t) => (
          <tr key={t.id} className={t.activo ? "" : "opacity-50"}>
            <td className="px-4 py-2 font-medium">{t.nombre}</td>
            <td className="px-4 py-2 text-xs text-slate-500">
              <span className="font-mono">{t.cuenta_codigo}</span> {t.cuenta_nombre}
            </td>
            <td className="px-4 py-2">
              <SelectDgii value={t.tipo_dgii ?? "02"} onChange={(v) => api.tiposGasto.actualizar(t.id, { tipo_dgii: v }).then(onCambio)} className="w-36 text-xs" />
            </td>
            <td className="px-4 py-2 text-center">{t.usos ?? 0}</td>
            <td className="px-4 py-2 text-right">
              <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => alternar(t)}>
                {t.activo ? "Ocultar" : "Volver a usar"}
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </Modal>
  );
}

function AnularGastoModal({ gasto, onClose, onAnulado }: { gasto: Gasto | null; onClose: () => void; onAnulado: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setMotivo("");
    setError("");
  }, [gasto?.id]);
  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!gasto) return;
    try {
      await api.gastos.anular(gasto.id, motivo);
      onAnulado();
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }
  return (
    <Modal open={!!gasto} onClose={onClose} title={`Anular gasto #${gasto?.numero ?? ""}`}>
      <form onSubmit={confirmar} className="space-y-3">
        <p className="text-sm text-slate-600">
          Se revierte en la contabilidad el gasto de {gasto?.suplidor} por {formatMoney(gasto?.total)}
          {gasto && (gasto.pagado ?? 0) > 0 ? ` y sus pagos (${formatMoney(gasto.pagado)} vuelven a la caja o al banco)` : ""}. No se borra: queda anulado.
        </p>
        <Input label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required autoFocus />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger">
            Anular
          </Button>
        </div>
      </form>
    </Modal>
  );
}
