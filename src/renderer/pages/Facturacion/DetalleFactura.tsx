import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import type { Cobro, CompanyConfig, Cuenta, FacturaDetalle } from "../../lib/types";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { Badge, Button, Card, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

const METODO_PAGO_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  CHEQUE: "Cheque",
};

export default function DetalleFactura() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [factura, setFactura] = useState<FacturaDetalle | null>(null);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [empresa, setEmpresa] = useState<CompanyConfig | null>(null);
  const [cuentasIngreso, setCuentasIngreso] = useState<Cuenta[]>([]);
  const [openCobro, setOpenCobro] = useState(false);
  const [openAnular, setOpenAnular] = useState(false);
  const [openDebito, setOpenDebito] = useState(false);
  const [openCredito, setOpenCredito] = useState(false);
  const [monto, setMonto] = useState(0);
  const [metodo, setMetodo] = useState<Cobro["metodo"]>("EFECTIVO");
  const [motivo, setMotivo] = useState("");
  const [debitoConcepto, setDebitoConcepto] = useState("");
  const [debitoMonto, setDebitoMonto] = useState(0);
  const [debitoCuentaId, setDebitoCuentaId] = useState<number | "">("");
  const [creditoConcepto, setCreditoConcepto] = useState("");
  const [creditoMonto, setCreditoMonto] = useState(0);
  const [creditoCuentaId, setCreditoCuentaId] = useState<number | "">("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [errorDebito, setErrorDebito] = useState("");
  const [errorCredito, setErrorCredito] = useState("");

  async function cargar() {
    if (!id) return;
    const f = (await api.facturas.obtener(Number(id))) as FacturaDetalle;
    setFactura(f);
    const c = await api.cobros.listarPorFactura(Number(id));
    setCobros(c as Cobro[]);
  }

  useEffect(() => {
    cargar();
  }, [id]);

  useEffect(() => {
    api.config.obtener().then(setEmpresa as any);
    api.cuentas.listar().then((c) => setCuentasIngreso(c.filter((x) => x.tipo === "INGRESOS" && x.es_movimiento)));
  }, []);

  if (!factura) return <p className="text-sm text-slate-400">Cargando...</p>;

  const cobrado = cobros.reduce((s, c) => s + c.monto, 0);
  const saldo = factura.total - cobrado;

  function abrirCobro() {
    setMonto(Math.round(saldo * 100) / 100);
    setMetodo("EFECTIVO");
    setError("");
    setOpenCobro(true);
  }

  async function confirmarCobro(e: React.FormEvent) {
    e.preventDefault();
    if (!factura) return;
    setGuardando(true);
    setError("");
    try {
      await api.cobros.crear({ factura_id: factura.id, fecha: todayIso(), monto, metodo });
      setOpenCobro(false);
      await cargar();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo registrar el cobro");
    } finally {
      setGuardando(false);
    }
  }

  function abrirDebito() {
    setDebitoConcepto("");
    setDebitoMonto(0);
    setDebitoCuentaId(cuentasIngreso[0]?.id ?? "");
    setErrorDebito("");
    setOpenDebito(true);
  }

  async function confirmarDebito(e: React.FormEvent) {
    e.preventDefault();
    if (!factura) return;
    setErrorDebito("");
    if (!debitoCuentaId) return setErrorDebito("Seleccione una cuenta de ingreso");
    if (debitoMonto <= 0) return setErrorDebito("El monto debe ser mayor a cero");
    setGuardando(true);
    try {
      await api.facturas.agregarNotaDebito({ factura_id: factura.id, concepto: debitoConcepto || "Cargo adicional", monto: debitoMonto, cuenta_ingreso_id: debitoCuentaId });
      setOpenDebito(false);
      await cargar();
    } catch (err: any) {
      setErrorDebito(err?.message ?? "No se pudo agregar la Nota de Debito");
    } finally {
      setGuardando(false);
    }
  }

  function abrirCredito() {
    setCreditoConcepto("");
    setCreditoMonto(0);
    setCreditoCuentaId(cuentasIngreso[0]?.id ?? "");
    setErrorCredito("");
    setOpenCredito(true);
  }

  async function confirmarCredito(e: React.FormEvent) {
    e.preventDefault();
    if (!factura) return;
    setErrorCredito("");
    if (!creditoCuentaId) return setErrorCredito("Seleccione una cuenta de ingreso");
    if (creditoMonto <= 0) return setErrorCredito("El monto debe ser mayor a cero");
    setGuardando(true);
    try {
      await api.facturas.agregarNotaCredito({ factura_id: factura.id, concepto: creditoConcepto || "Ajuste a favor del cliente", monto: creditoMonto, cuenta_ingreso_id: creditoCuentaId });
      setOpenCredito(false);
      await cargar();
    } catch (err: any) {
      setErrorCredito(err?.message ?? "No se pudo agregar la Nota de Credito");
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarAnular(e: React.FormEvent) {
    e.preventDefault();
    if (!factura) return;
    setGuardando(true);
    try {
      await api.facturas.anular(factura.id, motivo || "Sin motivo especificado");
      setOpenAnular(false);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={`Factura ${factura.ncf ?? factura.numero}`}
        subtitle={`${formatDate(factura.fecha)} · ${factura.cliente_nombre} · ${factura.condicion_pago === "CONTADO" ? `Contado (${METODO_PAGO_LABELS[factura.metodo_pago ?? "EFECTIVO"]})` : "Credito"}`}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>
              Imprimir
            </Button>
            {factura.estado === "PENDIENTE" && factura.condicion_pago === "CREDITO" && <Button onClick={abrirCobro}>Registrar cobro</Button>}
            {factura.estado !== "ANULADA" && (
              <Button variant="secondary" onClick={abrirDebito}>
                Nota de Debito
              </Button>
            )}
            {factura.estado !== "ANULADA" && (
              <Button variant="secondary" onClick={abrirCredito}>
                Nota de Credito
              </Button>
            )}
            {factura.estado !== "ANULADA" && (
              <Button variant="danger" onClick={() => setOpenAnular(true)}>
                Anular
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate("/facturas")}>
              Volver
            </Button>
          </div>
        }
      />

      <div className="mb-5 flex items-center gap-3 print:hidden">
        <Badge tone={factura.estado === "PAGADA" ? "green" : factura.estado === "ANULADA" ? "red" : "amber"}>{factura.estado}</Badge>
        {factura.nota_credito_ncf && (
          <span className="text-sm text-slate-500">
            Nota de Credito: <span className="font-mono">{factura.nota_credito_ncf}</span>
          </span>
        )}
        {factura.nota_debito_ncf && (
          <span className="text-sm text-slate-500">
            Nota de Debito: <span className="font-mono">{factura.nota_debito_ncf}</span>
          </span>
        )}
      </div>

      <div className="mb-6 hidden print:flex print:items-start print:justify-between print:border-b print:border-slate-300 print:pb-4">
        <div>
          <p className="text-lg font-bold text-slate-900">{empresa?.nombre_empresa}</p>
          {empresa?.rnc && <p className="text-sm text-slate-600">RNC: {empresa.rnc}</p>}
          {empresa?.direccion && <p className="text-sm text-slate-600">{empresa.direccion}</p>}
          {empresa?.telefono && <p className="text-sm text-slate-600">Tel: {empresa.telefono}</p>}
        </div>
        <div className="text-right">
          <p className="font-mono text-sm text-slate-600">NCF: {factura.ncf}</p>
          <p className="text-sm text-slate-600">Factura No. {factura.numero}</p>
          <p className="text-sm text-slate-600">Fecha: {formatDate(factura.fecha)}</p>
          <p className="text-sm text-slate-600">Cliente: {factura.cliente_nombre}</p>
          <p className="text-sm text-slate-600">{factura.condicion_pago === "CONTADO" ? "Contado" : "Credito"}</p>
        </div>
      </div>

      <Table columns={["Producto", "Modalidad", "Cantidad", "Precio", "Descuento", "ITBIS", "Subtotal"]}>
        {factura.lineas.map((l) => (
          <tr key={l.id}>
            <td className="px-4 py-2.5 font-medium text-slate-800">{l.producto_nombre}</td>
            <td className="px-4 py-2.5">{l.modalidad === "LLENO" ? "Lleno" : "Intercambio"}</td>
            <td className="px-4 py-2.5">{l.cantidad}</td>
            <td className="px-4 py-2.5">{formatMoney(l.precio_unitario)}</td>
            <td className="px-4 py-2.5">{formatMoney(l.descuento)}</td>
            <td className="px-4 py-2.5">{formatMoney(l.itbis)}</td>
            <td className="px-4 py-2.5">{formatMoney(l.subtotal)}</td>
          </tr>
        ))}
      </Table>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="space-y-1 p-5 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{formatMoney(factura.subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>ITBIS</span>
            <span>{formatMoney(factura.itbis)}</span>
          </div>
          {factura.fianza_total > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Fianza por envases</span>
              <span>{formatMoney(factura.fianza_total)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatMoney(factura.total)}</span>
          </div>
          {factura.condicion_pago === "CREDITO" && (
            <>
              <div className="flex justify-between text-emerald-600">
                <span>Cobrado</span>
                <span>{formatMoney(cobrado)}</span>
              </div>
              <div className="flex justify-between font-medium text-amber-600">
                <span>Saldo pendiente</span>
                <span>{formatMoney(saldo)}</span>
              </div>
            </>
          )}
        </Card>

        {factura.condicion_pago === "CREDITO" && (
          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Cobros registrados</h2>
            {cobros.length === 0 ? (
              <p className="text-sm text-slate-400">Sin cobros registrados</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {cobros.map((c) => (
                  <li key={c.id} className="flex justify-between py-1.5">
                    <span>
                      {formatDate(c.fecha)} · {c.metodo}
                    </span>
                    <span className="font-medium">{formatMoney(c.monto)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Modal open={openDebito} onClose={() => setOpenDebito(false)} title="Agregar Nota de Debito (B03)">
        <form onSubmit={confirmarDebito} className="space-y-3">
          <p className="text-sm text-slate-600">Usa esto para aumentar el monto de esta factura (ej. un cargo que se olvido cobrar).</p>
          <Input label="Concepto" value={debitoConcepto} onChange={(e) => setDebitoConcepto(e.target.value)} placeholder="Ej. Cargo por flete adicional" />
          <Input label="Monto a agregar (antes de ITBIS)" type="number" step="0.01" value={debitoMonto} onChange={(e) => setDebitoMonto(Number(e.target.value))} />
          <Select label="Cuenta de ingreso" value={debitoCuentaId} onChange={(e) => setDebitoCuentaId(Number(e.target.value))}>
            {cuentasIngreso.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} - {c.nombre}
              </option>
            ))}
          </Select>
          {errorDebito && <p className="text-sm text-red-600">{errorDebito}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpenDebito(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : "Agregar"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={openCredito} onClose={() => setOpenCredito(false)} title="Agregar Nota de Credito (B04)">
        <form onSubmit={confirmarCredito} className="space-y-3">
          <p className="text-sm text-slate-600">Usa esto para reducir el monto de esta factura sin anularla (ej. una devolucion parcial o un cobro de mas).</p>
          <Input label="Concepto" value={creditoConcepto} onChange={(e) => setCreditoConcepto(e.target.value)} placeholder="Ej. Devolucion de 1 unidad" />
          <Input label="Monto a descontar (antes de ITBIS)" type="number" step="0.01" max={factura.subtotal} value={creditoMonto} onChange={(e) => setCreditoMonto(Number(e.target.value))} />
          <Select label="Cuenta de ingreso afectada" value={creditoCuentaId} onChange={(e) => setCreditoCuentaId(Number(e.target.value))}>
            {cuentasIngreso.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} - {c.nombre}
              </option>
            ))}
          </Select>
          {errorCredito && <p className="text-sm text-red-600">{errorCredito}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpenCredito(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : "Agregar"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={openCobro} onClose={() => setOpenCobro(false)} title="Registrar cobro">
        <form onSubmit={confirmarCobro} className="space-y-3">
          <Input label="Monto" type="number" step="0.01" max={saldo} value={monto} onChange={(e) => setMonto(Number(e.target.value))} />
          <Select label="Metodo de pago" value={metodo} onChange={(e) => setMetodo(e.target.value as any)}>
            <option value="EFECTIVO">Efectivo</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="TARJETA">Tarjeta</option>
            <option value="CHEQUE">Cheque</option>
          </Select>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpenCobro(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : "Registrar"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={openAnular} onClose={() => setOpenAnular(false)} title="Anular factura">
        <form onSubmit={confirmarAnular} className="space-y-3">
          <p className="text-sm text-slate-600">Esta accion revierte el asiento contable, repone el inventario y el saldo de envases. No se puede deshacer.</p>
          <Input label="Motivo de anulacion" value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpenAnular(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" disabled={guardando}>
              {guardando ? "Anulando..." : "Confirmar anulacion"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
