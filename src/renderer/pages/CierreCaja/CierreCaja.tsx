import { useEffect, useMemo, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import { NOMBRE_RESULTADO, TONO_RESULTADO, useCaja } from "../../lib/caja";
import { formatMoney } from "../../lib/format";
import type { DetalleCierre, MotivoMovimientoCaja, MovimientoCaja, SesionCaja } from "../../lib/types";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";
import { ResumenCierreVista, imprimirComprobanteCierre } from "./ResumenCierre";
import type { AvisoImpresion } from "../../lib/ticket";

// Billetes y monedas de RD$ para contar la gaveta.
const DENOMINACIONES = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];

interface Motivo {
  codigo: MotivoMovimientoCaja;
  tipo: "ENTRADA" | "SALIDA";
  nombre: string;
  soloAdmin: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export default function CierreCaja() {
  const { cajas, cajaId, caja, sesion, cargando, seleccionarCaja, recargar, autor } = useCaja();
  const esAdmin = autor().rol === "ADMIN";

  const [montoInicial, setMontoInicial] = useState("");
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoCaja[]>([]);
  const [movForm, setMovForm] = useState<{ motivo: MotivoMovimientoCaja | ""; monto: string; concepto: string } | null>(null);

  const [cerrando, setCerrando] = useState(false);
  const [conteo, setConteo] = useState<Record<number, string>>({});
  const [contadoDirecto, setContadoDirecto] = useState("");
  const [usarConteo, setUsarConteo] = useState(true);
  const [observaciones, setObservaciones] = useState("");
  const [confirmar, setConfirmar] = useState(false);

  const [comprobante, setComprobante] = useState<SesionCaja | null>(null);
  const [avisoImpresion, setAvisoImpresion] = useState<AvisoImpresion | null>(null);
  const [misCierres, setMisCierres] = useState<SesionCaja[]>([]);

  async function cargarDatos(s: SesionCaja | null) {
    setMovimientos(s ? await api.caja.movimientos(s.id) : []);
    setMisCierres(await api.caja.misCierres({ autor: autor(), limite: 30 }));
  }

  useEffect(() => {
    api.caja.motivos().then((m) => setMotivos(m as Motivo[]));
    // Al entrar, traer los numeros al momento (pudo haber ventas desde que se abrio la caja).
    recargar();
  }, []);

  useEffect(() => {
    if (!cargando) cargarDatos(sesion);
  }, [sesion?.id, cargando]);

  async function actualizar() {
    const s = await recargar();
    await cargarDatos(s);
  }

  async function abrir(e: React.FormEvent) {
    e.preventDefault();
    if (!cajaId) return;
    setError("");
    setTrabajando(true);
    try {
      await api.caja.abrir({ caja_id: cajaId, monto_inicial: Number(montoInicial || 0), autor: autor() });
      setMontoInicial("");
      await actualizar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setTrabajando(false);
    }
  }

  async function guardarMovimiento(e: React.FormEvent) {
    e.preventDefault();
    if (!sesion || !movForm?.motivo) return;
    setError("");
    setTrabajando(true);
    try {
      await api.caja.movimiento({ sesion_id: sesion.id, motivo: movForm.motivo, monto: Number(movForm.monto), concepto: movForm.concepto, autor: autor() });
      setMovForm(null);
      await actualizar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setTrabajando(false);
    }
  }

  const totalConteo = useMemo(() => r2(DENOMINACIONES.reduce((s, d) => s + d * (Number(conteo[d]) || 0), 0)), [conteo]);
  const contado = usarConteo ? totalConteo : Number(contadoDirecto || 0);
  const esperado = sesion?.resumen.efectivo_esperado ?? 0;
  const diferencia = r2(contado - esperado);
  const resultado = Math.abs(diferencia) < 0.005 ? "CUADRE" : diferencia > 0 ? "SOBRANTE" : "FALTANTE";

  async function abrirCierre() {
    setError("");
    setConteo({});
    setContadoDirecto("");
    setObservaciones("");
    setConfirmar(false);
    await recargar(); // resumen al momento
    setCerrando(true);
  }

  async function cerrarCaja() {
    if (!sesion) return;
    setError("");
    setTrabajando(true);
    try {
      const notaConteo = usarConteo
        ? DENOMINACIONES.filter((d) => Number(conteo[d]) > 0)
            .map((d) => `${conteo[d]}x${d}`)
            .join(" ")
        : "";
      const obs = [observaciones.trim(), notaConteo ? `Conteo: ${notaConteo}` : ""].filter(Boolean).join(" | ");
      const cerrada = await api.caja.cerrar({ sesion_id: sesion.id, efectivo_contado: contado, observaciones: obs, autor: autor() });
      setCerrando(false);
      setAvisoImpresion(null);
      setComprobante(cerrada);
      await actualizar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setTrabajando(false);
    }
  }

  async function verCierre(id: number) {
    const d: DetalleCierre = await api.caja.detalle(id, { autor: autor() });
    setAvisoImpresion(null);
    setComprobante(d);
  }

  const motivosVisibles = motivos.filter((m) => esAdmin || !m.soloAdmin);

  return (
    <div>
      <PageHeader
        title="Cierre de Caja"
        subtitle="Abre la caja al empezar el dia, registra entradas y salidas de efectivo y cierrala al terminar."
        actions={
          cajas.length > 1 ? (
            <div className="w-56">
              <Select value={cajaId ?? ""} onChange={(e) => seleccionarCaja(Number(e.target.value))} disabled={!!sesion}>
                {cajas.map((c) => (
                  <option key={c.id} value={c.id}>
                    Esta computadora: {c.nombre}
                  </option>
                ))}
              </Select>
            </div>
          ) : undefined
        }
      />

      {error && !cerrando && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {cargando && !sesion && <p className="text-sm text-slate-400">Cargando...</p>}

      {!cargando && !caja && <p className="text-sm text-slate-500">No hay cajas activas. Un administrador debe crear una en Cierres de Caja.</p>}

      {/* ---------- Caja cerrada: abrir jornada ---------- */}
      {!cargando && caja && !sesion && (
        <Card className="max-w-lg p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">{caja.nombre} esta cerrada</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">Para vender hay que abrir la caja. Cuenta el dinero con que empiezas (el fondo o cambio) y escribelo aqui.</p>
          <form onSubmit={abrir} className="space-y-3">
            <Input label="Monto inicial en la gaveta (RD$)" type="number" min={0} step="0.01" value={montoInicial} onChange={(e) => setMontoInicial(e.target.value)} placeholder="0.00" autoFocus />
            <Button type="submit" disabled={trabajando}>
              {trabajando ? "Abriendo..." : "Abrir caja"}
            </Button>
          </form>
        </Card>
      )}

      {/* ---------- Caja abierta: jornada actual ---------- */}
      {sesion && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="font-semibold text-emerald-800">{sesion.caja_nombre} abierta</span>
            <span className="text-emerald-700">
              desde las {sesion.abierta_en.slice(11, 16)} del {sesion.abierta_en.slice(0, 10).split("-").reverse().join("/")} por {sesion.abierta_por_nombre}
            </span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={actualizar}>
                Actualizar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMovForm({ motivo: motivosVisibles.find((m) => m.tipo === "ENTRADA")?.codigo ?? "", monto: "", concepto: "" })}>
                + Entrada de efectivo
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMovForm({ motivo: motivosVisibles.find((m) => m.tipo === "SALIDA")?.codigo ?? "", monto: "", concepto: "" })}>
                − Salida de efectivo
              </Button>
              <Button size="sm" variant="danger" onClick={abrirCierre}>
                Cerrar caja
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs uppercase text-slate-400">Vendido hoy</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{formatMoney(sesion.resumen.ventas.total_general)}</p>
              <p className="text-xs text-slate-400">{sesion.resumen.ventas.cantidad} factura(s)</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-slate-400">En efectivo</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{formatMoney(sesion.resumen.ventas.por_metodo.EFECTIVO)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-slate-400">Tarjeta / transferencia</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{formatMoney(sesion.resumen.ventas.por_metodo.TARJETA + sesion.resumen.ventas.por_metodo.TRANSFERENCIA)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-slate-400">Deberia haber en la gaveta</p>
              <p className="mt-1 text-xl font-semibold text-brand-700">{formatMoney(sesion.resumen.efectivo_esperado)}</p>
            </Card>
          </div>

          <ResumenCierreVista s={sesion} />

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Entradas y salidas de efectivo</h2>
            <Table columns={["Hora", "Tipo", "Motivo", "Concepto", "Monto", "Usuario"]}>
              {movimientos.length === 0 && <EmptyRow colSpan={6} label="Sin entradas ni salidas de efectivo en esta jornada" />}
              {movimientos.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 text-slate-500">{m.creado_en.slice(11, 16)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={m.tipo === "ENTRADA" ? "green" : "amber"}>{m.tipo === "ENTRADA" ? "Entrada" : "Salida"}</Badge>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{motivos.find((x) => x.codigo === m.motivo)?.nombre ?? m.motivo}</td>
                  <td className="px-4 py-2 text-slate-500">{m.concepto}</td>
                  <td className="px-4 py-2 font-medium">{formatMoney(m.monto)}</td>
                  <td className="px-4 py-2 text-slate-500">{m.usuario_nombre}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      )}

      {/* ---------- Mis cierres ---------- */}
      <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-700">Mis cierres</h2>
      <Table columns={["Fecha", "Caja", "Apertura", "Cierre", "Vendido", "Esperado", "Contado", "Diferencia", "Resultado", ""]}>
        {misCierres.filter((c) => c.estado === "CERRADA").length === 0 && <EmptyRow colSpan={10} label="Todavia no has cerrado ninguna caja" />}
        {misCierres
          .filter((c) => c.estado === "CERRADA")
          .map((c) => (
            <tr key={c.id} className="hover:bg-slate-50">
              <td className="px-4 py-2">{c.abierta_en.slice(0, 10).split("-").reverse().join("/")}</td>
              <td className="px-4 py-2">{c.caja_nombre}</td>
              <td className="px-4 py-2 text-slate-500">{c.abierta_en.slice(11, 16)}</td>
              <td className="px-4 py-2 text-slate-500">{c.cerrada_en?.slice(11, 16)}</td>
              <td className="px-4 py-2">{formatMoney(c.resumen.ventas.total_general)}</td>
              <td className="px-4 py-2">{formatMoney(c.efectivo_esperado)}</td>
              <td className="px-4 py-2">{formatMoney(c.efectivo_contado_final)}</td>
              <td className={`px-4 py-2 font-medium ${(c.diferencia_final ?? 0) < 0 ? "text-red-600" : "text-slate-800"}`}>{formatMoney(c.diferencia_final)}</td>
              <td className="px-4 py-2">{c.resultado && <Badge tone={TONO_RESULTADO[c.resultado]}>{NOMBRE_RESULTADO[c.resultado]}</Badge>}</td>
              <td className="px-4 py-2 text-right">
                <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => verCierre(c.id)}>
                  Ver
                </button>
              </td>
            </tr>
          ))}
      </Table>

      {/* ---------- Movimiento de efectivo ---------- */}
      <Modal open={!!movForm} onClose={() => setMovForm(null)} title="Entrada o salida de efectivo">
        {movForm && (
          <form onSubmit={guardarMovimiento} className="space-y-3">
            <Select label="Motivo" value={movForm.motivo} onChange={(e) => setMovForm({ ...movForm, motivo: e.target.value as MotivoMovimientoCaja })}>
              {(["ENTRADA", "SALIDA"] as const).map((tipo) => (
                <optgroup key={tipo} label={tipo === "ENTRADA" ? "Entra dinero a la gaveta" : "Sale dinero de la gaveta"}>
                  {motivosVisibles
                    .filter((m) => m.tipo === tipo)
                    .map((m) => (
                      <option key={m.codigo} value={m.codigo}>
                        {m.nombre}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
            <Input label="Monto (RD$)" type="number" min={0.01} step="0.01" required value={movForm.monto} onChange={(e) => setMovForm({ ...movForm, monto: e.target.value })} />
            <Input label="Detalle (opcional)" value={movForm.concepto} onChange={(e) => setMovForm({ ...movForm, concepto: e.target.value })} placeholder="Ej. pago de agua para la oficina" />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setMovForm(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={trabajando || !movForm.motivo}>
                Guardar
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---------- Cerrar caja ---------- */}
      <Modal open={cerrando && !!sesion} onClose={() => setCerrando(false)} title={`Cerrar ${sesion?.caja_nombre ?? "caja"}`} width="max-w-5xl">
        {sesion && (
          <div className="space-y-4">
            <ResumenCierreVista s={sesion} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">Efectivo contado en la gaveta</p>
                  <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setUsarConteo(!usarConteo)}>
                    {usarConteo ? "Escribir el total directo" : "Contar por billetes"}
                  </button>
                </div>
                {usarConteo ? (
                  <div className="grid grid-cols-1 gap-y-1.5 sm:grid-cols-2 sm:gap-x-8">
                    {DENOMINACIONES.map((d) => (
                      <label key={d} className="flex items-center gap-2 text-sm">
                        <span className="w-14 shrink-0 text-right text-slate-500">RD${d}</span>
                        <span className="text-slate-400">×</span>
                        <input
                          type="number"
                          min={0}
                          className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                          value={conteo[d] ?? ""}
                          onChange={(e) => setConteo({ ...conteo, [d]: e.target.value })}
                        />
                        <span className="ml-auto whitespace-nowrap pl-2 tabular-nums text-xs text-slate-600">{Number(conteo[d]) ? formatMoney(d * Number(conteo[d])) : ""}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <Input label="Total contado (RD$)" type="number" min={0} step="0.01" value={contadoDirecto} onChange={(e) => setContadoDirecto(e.target.value)} autoFocus />
                )}
              </div>

              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div className="flex justify-between text-sm text-slate-600">
                  <span>Efectivo esperado</span>
                  <span className="tabular-nums">{formatMoney(esperado)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold text-slate-900">
                  <span>Efectivo contado</span>
                  <span className="tabular-nums">{formatMoney(contado)}</span>
                </div>
                <div
                  className={`flex items-center justify-between rounded-lg px-3 py-3 text-base font-bold ${
                    resultado === "CUADRE" ? "bg-emerald-50 text-emerald-700" : resultado === "SOBRANTE" ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-700"
                  }`}
                >
                  <span>
                    {NOMBRE_RESULTADO[resultado]}
                    {resultado !== "CUADRE" && <span className="ml-2 text-sm font-medium">(contado − esperado)</span>}
                  </span>
                  <span className="tabular-nums">{formatMoney(diferencia)}</span>
                </div>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Observaciones</span>
                  <textarea
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    rows={2}
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder={resultado === "CUADRE" ? "Opcional" : "Explica la diferencia, si sabes por que"}
                  />
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="mt-0.5" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} />
                  Confirmo el conteo. Entiendo que el cierre queda guardado y no se puede modificar; para seguir vendiendo hay que abrir una nueva jornada.
                </label>
                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setCerrando(false)}>
                    Volver
                  </Button>
                  <Button variant="danger" onClick={cerrarCaja} disabled={!confirmar || trabajando}>
                    {trabajando ? "Cerrando..." : "Cerrar caja definitivamente"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- Comprobante del cierre ---------- */}
      <Modal open={!!comprobante} onClose={() => setComprobante(null)} title={comprobante ? `Cierre de caja #${comprobante.id}` : ""} width="max-w-5xl">
        {comprobante && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={async () => setAvisoImpresion(await imprimirComprobanteCierre(comprobante))}>Imprimir comprobante</Button>
              {comprobante.resultado && <Badge tone={TONO_RESULTADO[comprobante.resultado]}>{NOMBRE_RESULTADO[comprobante.resultado]}</Badge>}
              <span className="text-sm text-slate-500">
                Cerrado el {comprobante.cerrada_en?.slice(0, 10).split("-").reverse().join("/")} a las {comprobante.cerrada_en?.slice(11, 16)} por {comprobante.cerrada_por_nombre}
              </span>
            </div>
            {avisoImpresion && <p className={`rounded-lg px-3 py-2 text-sm ${avisoImpresion.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{avisoImpresion.texto}</p>}
            <ResumenCierreVista s={comprobante} />
          </div>
        )}
      </Modal>
    </div>
  );
}
