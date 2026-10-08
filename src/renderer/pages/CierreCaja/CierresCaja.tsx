import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, mensajeDeError } from "../../lib/api";
import { NOMBRE_METODO, NOMBRE_RESULTADO, TONO_RESULTADO, useCaja } from "../../lib/caja";
import { descargarCsv } from "../../lib/exportar";
import { firstDayOfMonthIso, formatMoney, todayIso } from "../../lib/format";
import type { Caja, DetalleCierre, FiltrosCierres, ListaCierres } from "../../lib/types";
import type { AvisoImpresion } from "../../lib/ticket";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";
import { ResumenCierreVista, imprimirComprobanteCierre } from "./ResumenCierre";

type Periodo = "TODAS" | "HOY" | "MES" | "DIA" | "RANGO";
type PestanaDetalle = "FACTURAS" | "MOVIMIENTOS" | "CORRECCIONES" | "AUDITORIA";

const fecha = (fh: string | null | undefined) => (fh ? fh.slice(0, 10).split("-").reverse().join("/") : "-");
const hora = (fh: string | null | undefined) => (fh ? fh.slice(11, 16) : "-");

const ACCIONES: Record<string, string> = {
  ABRIR_CAJA: "Abrio la caja",
  CERRAR_CAJA: "Cerro la caja",
  ENTRADA_EFECTIVO: "Entrada de efectivo",
  SALIDA_EFECTIVO: "Salida de efectivo",
  CORREGIR_CIERRE: "Correccion administrativa",
};

export default function CierresCaja() {
  const { autor } = useCaja();
  const [lista, setLista] = useState<ListaCierres | null>(null);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [periodo, setPeriodo] = useState<Periodo>("MES");
  const [dia, setDia] = useState(todayIso());
  const [desde, setDesde] = useState(firstDayOfMonthIso());
  const [hasta, setHasta] = useState(todayIso());
  const [cajero, setCajero] = useState("");
  const [cajaId, setCajaId] = useState<number | "">("");
  const [estado, setEstado] = useState<FiltrosCierres["estado"] | "">("");
  const [metodo, setMetodo] = useState<FiltrosCierres["metodo"] | "">("");

  const [detalle, setDetalle] = useState<DetalleCierre | null>(null);
  const [pestana, setPestana] = useState<PestanaDetalle>("FACTURAS");
  const [aviso, setAviso] = useState<AvisoImpresion | null>(null);
  const [correccion, setCorreccion] = useState<{ contado: string; motivo: string } | null>(null);
  const [error, setError] = useState("");
  const [gestionCajas, setGestionCajas] = useState(false);
  const [nuevaCaja, setNuevaCaja] = useState("");

  const filtros = useMemo((): FiltrosCierres => {
    const f: FiltrosCierres = {};
    if (periodo === "HOY") f.desde = f.hasta = todayIso();
    if (periodo === "MES") {
      f.desde = firstDayOfMonthIso();
      f.hasta = todayIso();
    }
    if (periodo === "DIA") f.desde = f.hasta = dia;
    if (periodo === "RANGO") {
      f.desde = desde || undefined;
      f.hasta = hasta || undefined;
    }
    if (cajero) f.cajero = cajero;
    if (cajaId) f.caja_id = cajaId;
    if (estado) f.estado = estado;
    if (metodo) f.metodo = metodo;
    return f;
  }, [periodo, dia, desde, hasta, cajero, cajaId, estado, metodo]);

  async function cargar() {
    const [l, c] = await Promise.all([api.cierres.listar(filtros), api.cajas.listar()]);
    setLista(l);
    setCajas(c);
  }

  useEffect(() => {
    cargar();
  }, [filtros]);

  async function abrirDetalle(id: number) {
    setAviso(null);
    setError("");
    setCorreccion(null);
    setPestana("FACTURAS");
    setDetalle(await api.cierres.obtener(id));
  }

  async function guardarCorreccion(e: React.FormEvent) {
    e.preventDefault();
    if (!detalle || !correccion) return;
    setError("");
    try {
      await api.cierres.corregir({ sesion_id: detalle.id, efectivo_contado: Number(correccion.contado), motivo: correccion.motivo, autor: autor() });
      setCorreccion(null);
      setDetalle(await api.cierres.obtener(detalle.id));
      setPestana("CORRECCIONES");
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function crearCaja(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.cajas.crear({ nombre: nuevaCaja, autor: autor() });
      setNuevaCaja("");
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  async function alternarCaja(c: Caja) {
    setError("");
    try {
      await api.cajas.actualizar(c.id, { activa: c.activa ? 0 : 1, autor: autor() });
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  function exportar() {
    if (!lista) return;
    descargarCsv(
      `cierres-de-caja-${todayIso()}.csv`,
      ["Jornada", "Fecha", "Caja", "Abrio", "Apertura", "Cerro", "Cierre", "Monto inicial", "Total vendido", "Efectivo", "Tarjeta", "Transferencia", "Credito", "Entradas", "Salidas", "Esperado", "Contado", "Diferencia", "Resultado", "Correcciones"],
      lista.cierres.map((c) => [
        c.id,
        c.abierta_en.slice(0, 10),
        c.caja_nombre,
        c.abierta_por_nombre,
        hora(c.abierta_en),
        c.cerrada_por_nombre ?? "",
        hora(c.cerrada_en),
        c.monto_inicial.toFixed(2),
        c.resumen.ventas.total_general.toFixed(2),
        c.resumen.ventas.por_metodo.EFECTIVO.toFixed(2),
        c.resumen.ventas.por_metodo.TARJETA.toFixed(2),
        c.resumen.ventas.por_metodo.TRANSFERENCIA.toFixed(2),
        c.resumen.ventas.por_metodo.CREDITO.toFixed(2),
        c.resumen.entradas.toFixed(2),
        c.resumen.salidas.toFixed(2),
        (c.efectivo_esperado ?? 0).toFixed(2),
        c.efectivo_contado_final === null ? "" : c.efectivo_contado_final.toFixed(2),
        c.diferencia_final === null ? "" : c.diferencia_final.toFixed(2),
        c.estado === "ABIERTA" ? "Abierta" : c.resultado ? NOMBRE_RESULTADO[c.resultado] : "",
        c.correcciones,
      ])
    );
  }

  const t = lista?.totales;

  return (
    <div>
      <PageHeader
        title="Cierres de Caja"
        subtitle="Consulta las jornadas de cada caja: ventas, efectivo y diferencias. Los cierres no se editan; las correcciones quedan registradas."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={exportar} disabled={!lista?.cierres.length}>
              Exportar a Excel (CSV)
            </Button>
            <Button variant="secondary" onClick={() => setGestionCajas(true)}>
              Cajas
            </Button>
          </div>
        }
      />

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="w-44">
          <Select label="Fecha" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
            <option value="TODAS">Todas</option>
            <option value="HOY">Hoy</option>
            <option value="MES">Este mes</option>
            <option value="DIA">Fecha especifica</option>
            <option value="RANGO">Rango de fechas</option>
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
        <div className="w-44">
          <Select label="Cajero" value={cajero} onChange={(e) => setCajero(e.target.value)}>
            <option value="">Todos</option>
            {lista?.cajeros.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select label="Caja" value={cajaId} onChange={(e) => setCajaId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Todas</option>
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as any)}>
            <option value="">Todos</option>
            <option value="ABIERTA">Abierta</option>
            <option value="CUADRE">Cuadre exacto</option>
            <option value="SOBRANTE">Sobrante</option>
            <option value="FALTANTE">Faltante</option>
          </Select>
        </div>
        <div className="w-40">
          <Select label="Metodo de pago" value={metodo} onChange={(e) => setMetodo(e.target.value as any)}>
            <option value="">Todos</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="TARJETA">Tarjeta</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="CHEQUE">Cheque</option>
            <option value="CREDITO">Credito</option>
          </Select>
        </div>
      </div>

      {/* Resumen comparativo */}
      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {(
            [
              ["Ventas totales", t.ventas, `${t.jornadas} jornada(s)`],
              ["Efectivo", t.efectivo, "ventas + cobros"],
              ["Tarjetas", t.tarjeta, ""],
              ["Transferencias", t.transferencia, ""],
              ["Devoluciones", t.devoluciones, "anuladas + envases"],
              ["Entradas de efectivo", t.entradas, ""],
              ["Salidas de efectivo", t.salidas, ""],
              ["Sobrantes", t.sobrantes, ""],
              ["Faltantes", t.faltantes, ""],
              ["A credito", t.credito, "no entra dinero"],
            ] as [string, number, string][]
          ).map(([etq, val, nota]) => (
            <Card key={etq} className="p-3">
              <p className="text-xs uppercase text-slate-400">{etq}</p>
              <p className={`mt-1 text-lg font-semibold ${etq === "Faltantes" && val ? "text-red-600" : etq === "Sobrantes" && val ? "text-brand-700" : "text-slate-900"}`}>{formatMoney(val)}</p>
              {nota && <p className="text-[11px] text-slate-400">{nota}</p>}
            </Card>
          ))}
        </div>
      )}

      <Table columns={["Fecha", "Caja", "Cajero", "Horario", "Inicial", "Vendido", "Esperado / contado", "Diferencia", "Estado"]}>
        {lista && lista.cierres.length === 0 && <EmptyRow colSpan={9} label="No hay jornadas con estos filtros" />}
        {lista?.cierres.map((c) => (
          <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => abrirDetalle(c.id)}>
            <td className="whitespace-nowrap px-4 py-2.5">{fecha(c.abierta_en)}</td>
            <td className="whitespace-nowrap px-4 py-2.5">{c.caja_nombre}</td>
            <td className="px-4 py-2.5">
              {c.abierta_por_nombre}
              {c.cerrada_por_nombre && c.cerrada_por_nombre !== c.abierta_por_nombre && <span className="text-xs text-slate-400"> / {c.cerrada_por_nombre}</span>}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
              {hora(c.abierta_en)} – {c.cerrada_en ? hora(c.cerrada_en) : "..."}
            </td>
            <td className="px-4 py-2.5">{formatMoney(c.monto_inicial)}</td>
            <td className="px-4 py-2.5 font-medium">{formatMoney(c.resumen.ventas.total_general)}</td>
            <td className="whitespace-nowrap px-4 py-2.5">
              <p>{formatMoney(c.efectivo_esperado)}</p>
              <p className="text-xs text-slate-500">{c.estado === "CERRADA" ? formatMoney(c.efectivo_contado_final) : "sin contar"}</p>
            </td>
            <td className={`whitespace-nowrap px-4 py-2.5 font-medium ${(c.diferencia_final ?? 0) < 0 ? "text-red-600" : (c.diferencia_final ?? 0) > 0 ? "text-brand-700" : ""}`}>
              {c.estado === "CERRADA" ? formatMoney(c.diferencia_final) : "-"}
              {c.correcciones > 0 && <span className="ml-1 text-xs text-amber-600" title="Tiene correcciones administrativas">✎</span>}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5">
              {c.estado === "ABIERTA" ? <Badge tone="amber">Abierta</Badge> : c.resultado && <Badge tone={TONO_RESULTADO[c.resultado]}>{NOMBRE_RESULTADO[c.resultado]}</Badge>}
            </td>
          </tr>
        ))}
      </Table>

      {/* Detalle completo */}
      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={detalle ? `Jornada #${detalle.id} · ${detalle.caja_nombre} · ${fecha(detalle.abierta_en)}` : ""} width="max-w-6xl">
        {detalle && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {detalle.estado === "CERRADA" && <Button onClick={async () => setAviso(await imprimirComprobanteCierre(detalle))}>Imprimir comprobante</Button>}
              {detalle.estado === "CERRADA" && (
                <Button variant="secondary" onClick={() => setCorreccion({ contado: String(detalle.efectivo_contado_final ?? ""), motivo: "" })}>
                  Registrar correccion
                </Button>
              )}
              {detalle.estado === "ABIERTA" && <Badge tone="amber">Jornada abierta: los numeros se calculan en vivo</Badge>}
            </div>
            {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{aviso.texto}</p>}

            {correccion && (
              <form onSubmit={guardarCorreccion} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 sm:grid-cols-4">
                <p className="text-xs text-amber-800 sm:col-span-4">
                  El cierre original no se modifica. La correccion queda registrada con tu nombre, la fecha y el motivo, y se ajusta la contabilidad (cuenta Diferencias de Caja).
                </p>
                <Input label="Efectivo contado correcto (RD$)" type="number" min={0} step="0.01" value={correccion.contado} onChange={(e) => setCorreccion({ ...correccion, contado: e.target.value })} />
                <div className="sm:col-span-2">
                  <Input label="Motivo" value={correccion.motivo} onChange={(e) => setCorreccion({ ...correccion, motivo: e.target.value })} placeholder="Ej. se recontó y faltaba un billete de 500 en la bolsa" />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm">
                    Guardar correccion
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCorreccion(null)}>
                    Cancelar
                  </Button>
                </div>
                {error && <p className="text-xs text-red-600 sm:col-span-4">{error}</p>}
              </form>
            )}

            <ResumenCierreVista s={detalle} />

            <div className="flex gap-1 border-b border-slate-200">
              {(
                [
                  ["FACTURAS", `Facturas (${detalle.facturas.length})`],
                  ["MOVIMIENTOS", `Efectivo, cobros y devoluciones (${detalle.movimientos.length + detalle.cobros_detalle.length + detalle.reembolsos.length + detalle.anuladas_detalle.length})`],
                  ["CORRECCIONES", `Correcciones (${detalle.historial_correcciones.length})`],
                  ["AUDITORIA", `Auditoria (${detalle.auditoria.length})`],
                ] as [PestanaDetalle, string][]
              ).map(([v, etq]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPestana(v)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${pestana === v ? "border-brand-600 font-semibold text-brand-700" : "border-transparent text-slate-500"}`}
                >
                  {etq}
                </button>
              ))}
            </div>

            {pestana === "FACTURAS" && (
              <Table columns={["Hora", "Factura", "Cliente", "Pago", "Total", "Estado", "Usuario"]}>
                {detalle.facturas.length === 0 && <EmptyRow colSpan={7} label="Sin facturas en esta jornada" />}
                {detalle.facturas.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-2 text-slate-500">{hora(f.creado_en)}</td>
                    <td className="px-4 py-2">
                      <Link to={`/facturas/${f.id}`} className="text-brand-700 hover:underline">
                        #{f.numero}
                      </Link>{" "}
                      <span className="font-mono text-xs text-slate-400">{f.ncf}</span>
                    </td>
                    <td className="px-4 py-2">{f.cliente_nombre}</td>
                    <td className="px-4 py-2 text-xs">{f.condicion_pago === "CREDITO" ? "Credito" : NOMBRE_METODO[f.metodo_pago ?? "EFECTIVO"]}</td>
                    <td className="px-4 py-2 font-medium">{formatMoney(f.total)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={f.estado === "ANULADA" ? "red" : f.estado === "PAGADA" ? "green" : "amber"}>{f.estado}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{f.creado_por ?? "-"}</td>
                  </tr>
                ))}
              </Table>
            )}

            {pestana === "MOVIMIENTOS" && (
              <Table columns={["Hora / fecha", "Tipo", "Detalle", "Monto", "Usuario"]}>
                {detalle.movimientos.length + detalle.cobros_detalle.length + detalle.reembolsos.length + detalle.anuladas_detalle.length === 0 && <EmptyRow colSpan={5} label="Sin movimientos" />}
                {detalle.movimientos.map((m) => (
                  <tr key={`m${m.id}`}>
                    <td className="px-4 py-2 text-slate-500">{hora(m.creado_en)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={m.tipo === "ENTRADA" ? "green" : "amber"}>{m.tipo === "ENTRADA" ? "Entrada" : "Salida"}</Badge>
                    </td>
                    <td className="px-4 py-2">{m.concepto}</td>
                    <td className="px-4 py-2 font-medium">{formatMoney(m.monto)}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{m.usuario_nombre}</td>
                  </tr>
                ))}
                {detalle.cobros_detalle.map((c) => (
                  <tr key={`c${c.id}`}>
                    <td className="px-4 py-2 text-slate-500">{fecha(c.fecha)}</td>
                    <td className="px-4 py-2">
                      <Badge tone="blue">Cobro</Badge>
                    </td>
                    <td className="px-4 py-2">
                      Factura a credito <span className="font-mono text-xs">{c.ncf}</span> · {NOMBRE_METODO[c.metodo]}
                    </td>
                    <td className="px-4 py-2 font-medium">{formatMoney(c.monto)}</td>
                    <td className="px-4 py-2" />
                  </tr>
                ))}
                {detalle.reembolsos.map((r) => (
                  <tr key={`r${r.id}`}>
                    <td className="px-4 py-2 text-slate-500">{fecha(r.fecha)}</td>
                    <td className="px-4 py-2">
                      <Badge tone="amber">Reembolso</Badge>
                    </td>
                    <td className="px-4 py-2">
                      Deposito de {r.cantidad} {r.producto_nombre} a {r.cliente_nombre}
                    </td>
                    <td className="px-4 py-2 font-medium">{formatMoney(r.monto_reembolsado)}</td>
                    <td className="px-4 py-2" />
                  </tr>
                ))}
                {detalle.anuladas_detalle.map((a) => (
                  <tr key={`a${a.id}`}>
                    <td className="px-4 py-2 text-slate-500">-</td>
                    <td className="px-4 py-2">
                      <Badge tone="red">Anulada</Badge>
                    </td>
                    <td className="px-4 py-2">
                      Factura #{a.numero} <span className="font-mono text-xs">{a.ncf}</span>
                      {a.de_otra_jornada ? " (de otra jornada)" : ""}
                    </td>
                    <td className="px-4 py-2 font-medium">{formatMoney(a.total)}</td>
                    <td className="px-4 py-2" />
                  </tr>
                ))}
              </Table>
            )}

            {pestana === "CORRECCIONES" && (
              <Table columns={["Fecha", "Administrador", "Motivo", "Contado antes", "Contado corregido", "Nueva diferencia"]}>
                {detalle.historial_correcciones.length === 0 && <EmptyRow colSpan={6} label="Este cierre no tiene correcciones" />}
                {detalle.historial_correcciones.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                      {fecha(c.creado_en)} {hora(c.creado_en)}
                    </td>
                    <td className="px-4 py-2">{c.usuario_nombre}</td>
                    <td className="px-4 py-2">{c.motivo}</td>
                    <td className="px-4 py-2">{formatMoney(c.efectivo_contado_anterior)}</td>
                    <td className="px-4 py-2 font-medium">{formatMoney(c.efectivo_contado_nuevo)}</td>
                    <td className={`px-4 py-2 font-medium ${c.diferencia_nueva < 0 ? "text-red-600" : ""}`}>{formatMoney(c.diferencia_nueva)}</td>
                  </tr>
                ))}
              </Table>
            )}

            {pestana === "AUDITORIA" && (
              <Table columns={["Fecha y hora", "Usuario", "Accion", "Detalle"]}>
                {detalle.auditoria.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                      {fecha(a.fecha)} {a.fecha.slice(11, 19)}
                    </td>
                    <td className="px-4 py-2">{a.usuario_nombre}</td>
                    <td className="px-4 py-2 font-medium">{ACCIONES[a.accion] ?? a.accion}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-500">{a.detalle}</td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        )}
      </Modal>

      {/* Gestion de cajas */}
      <Modal open={gestionCajas} onClose={() => setGestionCajas(false)} title="Cajas">
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Cada gaveta de dinero es una caja (ej. "Caja principal", "Mostrador"). Cada computadora elige la suya en Cierre de Caja.</p>
          <Table columns={["Caja", "Estado", "Jornada", ""]}>
            {cajas.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2 font-medium">{c.nombre}</td>
                <td className="px-4 py-2">
                  <Badge tone={c.activa ? "green" : "slate"}>{c.activa ? "Activa" : "Inactiva"}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{c.sesion_abierta_id ? `Abierta por ${c.abierta_por_nombre}` : "Cerrada"}</td>
                <td className="px-4 py-2 text-right">
                  <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => alternarCaja(c)}>
                    {c.activa ? "Desactivar" : "Activar"}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          <form onSubmit={crearCaja} className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Nueva caja" value={nuevaCaja} onChange={(e) => setNuevaCaja(e.target.value)} placeholder="Ej. Mostrador" />
            </div>
            <Button type="submit" disabled={!nuevaCaja.trim()}>
              Crear
            </Button>
          </form>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
