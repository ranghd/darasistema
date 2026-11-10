import { useEffect, useMemo, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { html, imprimirHtml } from "../../lib/exportar";
import type { Autor, Banco, Empleado, EmpleadoInput, FrecuenciaPago, Nomina as NominaPago, NominaDetalle } from "../../lib/types";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, StatCard, Table } from "../../components/ui";
import { Pestanas, RangoFechas, rangoDe } from "../../components/reportes";

const num = (t: string) => Number(String(t).replace(/,/g, "")) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const FRECUENCIAS: [FrecuenciaPago, string][] = [
  ["SEMANAL", "Por semana"],
  ["QUINCENAL", "Por quincena"],
  ["MENSUAL", "Por mes"],
];
const nombreFrecuencia = (f: string) => FRECUENCIAS.find(([k]) => k === f)?.[1] ?? f;
const METODOS: Record<string, string> = { EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", CHEQUE: "Cheque" };

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// El periodo que se suele pagar hoy: la ultima semana, quincena o el mes que corre.
function periodoSugerido(frecuencia: FrecuenciaPago, hoy: string): { desde: string; hasta: string } {
  if (frecuencia === "SEMANAL") return { desde: sumarDias(hoy, -6), hasta: hoy };
  if (frecuencia === "QUINCENAL") return { desde: sumarDias(hoy, -14), hasta: hoy };
  return { desde: hoy.slice(0, 8) + "01", hasta: hoy };
}

// ---------- Recibos para imprimir ----------

function htmlRecibos(n: NominaDetalle, empresa: string): string {
  const hoja = n.lineas
    .map(
      (l) => `<div class="doc">
        <h2>${html(empresa)}</h2>
        <div class="muted">Recibo de pago de sueldo - Nomina #${n.numero}</div>
        <p style="margin:8px 0 2px"><b>${html(l.empleado_nombre)}</b>${l.cargo ? ` <span class="muted">(${html(l.cargo)})</span>` : ""}</p>
        <div class="muted">Periodo: del ${formatDate(n.desde)} al ${formatDate(n.hasta)} (${nombreFrecuencia(n.frecuencia).toLowerCase()}) · Pagado el ${formatDate(n.fecha)} en ${METODOS[n.metodo].toLowerCase()}</div>
        <div class="totales" style="margin-left:0;width:300px">
          <div><span>Sueldo</span><span>${formatMoney(l.sueldo)}</span></div>
          ${l.extras ? `<div><span>Horas extras / bonos</span><span>${formatMoney(l.extras)}</span></div>` : ""}
          ${l.descuentos ? `<div><span>Descuentos</span><span>- ${formatMoney(l.descuentos)}</span></div>` : ""}
          <div class="fuerte"><span>Total recibido</span><span>${formatMoney(l.neto)}</span></div>
        </div>
        ${l.nota ? `<div class="muted" style="margin-top:4px">${html(l.nota)}</div>` : ""}
        <div style="margin-top:34px;display:flex;gap:40px">
          <div style="flex:1;border-top:1px solid #0f172a;padding-top:3px;text-align:center">Recibi conforme: ${html(l.empleado_nombre)}</div>
          <div style="flex:1;border-top:1px solid #0f172a;padding-top:3px;text-align:center">Pagado por</div>
        </div>
      </div>`
    )
    .join("");
  return hoja;
}

function htmlPlanilla(n: NominaDetalle, empresa: string): string {
  const filas = n.lineas
    .map(
      (l) =>
        `<tr><td>${html(l.empleado_nombre)}</td><td>${html(l.cargo ?? "")}</td><td class="r">${formatMoney(l.sueldo)}</td><td class="r">${formatMoney(l.extras)}</td><td class="r">${formatMoney(l.descuentos)}</td><td class="r"><b>${formatMoney(l.neto)}</b></td><td style="width:140px"></td></tr>`
    )
    .join("");
  return `<h1>${html(empresa)}</h1>
    <h2>Planilla de nomina #${n.numero}</h2>
    <div class="muted">Del ${formatDate(n.desde)} al ${formatDate(n.hasta)} · ${nombreFrecuencia(n.frecuencia)} · Pagado el ${formatDate(n.fecha)} (${METODOS[n.metodo]})</div>
    <table><thead><tr><th>Empleado</th><th>Cargo</th><th class="r">Sueldo</th><th class="r">Extras</th><th class="r">Descuentos</th><th class="r">Neto</th><th>Firma</th></tr></thead><tbody>${filas}</tbody>
    <tfoot><tr><td colspan="2"><b>TOTAL</b></td><td class="r"><b>${formatMoney(n.total_sueldos)}</b></td><td class="r"><b>${formatMoney(n.total_extras)}</b></td><td class="r"><b>${formatMoney(n.total_descuentos)}</b></td><td class="r"><b>${formatMoney(n.total_neto)}</b></td><td></td></tr></tfoot></table>`;
}

// ---------- Pantalla ----------

type Pestana = "pagar" | "pagos" | "empleados";

export default function Nomina() {
  const { usuario } = useAuth();
  const [pestana, setPestana] = useState<Pestana>("pagar");
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [empresa, setEmpresa] = useState("");
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

  async function cargarEmpleados() {
    setEmpleados(await api.empleados.listar());
  }
  useEffect(() => {
    cargarEmpleados().catch((e) => setAviso({ tono: "error", texto: mensajeDeError(e) }));
    api.config.obtener().then((c: any) => setEmpresa(c?.nombre_empresa ?? ""));
  }, []);

  const autor = { id: usuario?.id ?? null, nombre: usuario?.nombre ?? "", rol: usuario?.rol };

  return (
    <div>
      <PageHeader title="Nomina" subtitle="Pagar a los empleados: por semana, quincena o mes, con recibo para cada uno." />
      {aviso && (
        <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm ${aviso.tono === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`} onClick={() => setAviso(null)}>
          {aviso.texto}
        </div>
      )}
      <Pestanas<Pestana>
        opciones={[
          ["pagar", "Pagar nomina"],
          ["pagos", "Pagos hechos"],
          ["empleados", `Empleados (${empleados.filter((e) => e.activo).length})`],
        ]}
        valor={pestana}
        onChange={setPestana}
      />
      {pestana === "pagar" && <PagarNomina empleados={empleados} empresa={empresa} autor={autor} setAviso={setAviso} alPagar={cargarEmpleados} irAEmpleados={() => setPestana("empleados")} />}
      {pestana === "pagos" && <PagosHechos empresa={empresa} autor={autor} setAviso={setAviso} />}
      {pestana === "empleados" && <Empleados empleados={empleados} recargar={cargarEmpleados} setAviso={setAviso} />}
    </div>
  );
}


type SetAviso = (a: { tono: "ok" | "error"; texto: string } | null) => void;

interface FilaPago {
  incluir: boolean;
  sueldo: string;
  extras: string;
  descuentos: string;
  nota: string;
}

function PagarNomina({
  empleados,
  empresa,
  autor,
  setAviso,
  alPagar,
  irAEmpleados,
}: {
  empleados: Empleado[];
  empresa: string;
  autor: Autor;
  setAviso: SetAviso;
  alPagar: () => void;
  irAEmpleados: () => void;
}) {
  const hoy = todayIso();
  const [frecuencia, setFrecuencia] = useState<FrecuenciaPago>("SEMANAL");
  const [periodo, setPeriodo] = useState(periodoSugerido("SEMANAL", hoy));
  const [fecha, setFecha] = useState(hoy);
  const [filas, setFilas] = useState<Record<number, FilaPago>>({});
  const [metodo, setMetodo] = useState<"CAJA" | "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE">("EFECTIVO");
  const [bancoId, setBancoId] = useState<number | "">("");
  const [referencia, setReferencia] = useState("");
  const [notas, setNotas] = useState("");
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [cajaAbierta, setCajaAbierta] = useState<{ sesion_id: number; nombre: string; efectivo: number } | null>(null);
  const [ultimos, setUltimos] = useState<Record<number, { hasta: string }>>({});
  const [confirmar, setConfirmar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [pagada, setPagada] = useState<NominaDetalle | null>(null);

  async function cargarContexto() {
    const [b, u, cajas] = await Promise.all([api.bancos.listar(), api.nomina.ultimosPagos(), api.cajas.listar()]);
    setBancos(b.filter((x) => x.activo));
    setUltimos(Object.fromEntries(u.map((x) => [x.empleado_id, { hasta: x.hasta }])));
    const abierta = cajas.find((c) => c.activa && c.sesion_abierta_id);
    if (abierta?.sesion_abierta_id) {
      const s = await api.caja.resumen(abierta.sesion_abierta_id);
      setCajaAbierta({ sesion_id: abierta.sesion_abierta_id, nombre: abierta.nombre, efectivo: s.resumen?.efectivo_esperado ?? 0 });
      setMetodo("CAJA");
    } else {
      setCajaAbierta(null);
    }
  }
  useEffect(() => {
    cargarContexto().catch((e) => setAviso({ tono: "error", texto: mensajeDeError(e) }));
  }, []);

  const lista = useMemo(() => empleados.filter((e) => e.activo && e.frecuencia === frecuencia), [empleados, frecuencia]);

  // Cada vez que cambia la lista o el periodo se arma de nuevo: marcados los que no se han pagado ese periodo.
  useEffect(() => {
    setFilas((prev) => {
      const nuevo: Record<number, FilaPago> = {};
      for (const e of lista) {
        const ya = ultimos[e.id] && ultimos[e.id].hasta >= periodo.desde;
        const antes = prev[e.id];
        nuevo[e.id] = {
          incluir: antes ? antes.incluir && !ya : !ya,
          sueldo: antes?.sueldo ?? String(e.sueldo),
          extras: antes?.extras ?? "",
          descuentos: antes?.descuentos ?? "",
          nota: antes?.nota ?? "",
        };
      }
      return nuevo;
    });
  }, [lista, ultimos, periodo.desde]);

  function cambiarFrecuencia(f: FrecuenciaPago) {
    setFrecuencia(f);
    setPeriodo(periodoSugerido(f, hoy));
    setFilas({});
  }
  const poner = (id: number, cambio: Partial<FilaPago>) => setFilas((p) => ({ ...p, [id]: { ...p[id], ...cambio } }));

  const calculo = lista.map((e) => {
    const f = filas[e.id];
    const neto = f ? r2(num(f.sueldo) + num(f.extras) - num(f.descuentos)) : 0;
    return { e, f, neto, ya: !!ultimos[e.id] && ultimos[e.id].hasta >= periodo.desde };
  });
  const elegidos = calculo.filter((c) => c.f?.incluir);
  const total = r2(elegidos.reduce((s, c) => s + c.neto, 0));
  const faltaEfectivo = metodo === "CAJA" && cajaAbierta && total > cajaAbierta.efectivo + 0.005;
  const hayNegativo = elegidos.some((c) => c.neto < 0);

  async function pagar() {
    setGuardando(true);
    try {
      const detalle = await api.nomina.pagar({
        fecha,
        desde: periodo.desde,
        hasta: periodo.hasta,
        frecuencia,
        metodo: metodo === "CAJA" ? "EFECTIVO" : metodo,
        banco_id: metodo === "TRANSFERENCIA" || metodo === "CHEQUE" ? bancoId || null : null,
        referencia: referencia.trim() || undefined,
        caja_sesion_id: metodo === "CAJA" ? cajaAbierta?.sesion_id : null,
        notas: notas.trim() || undefined,
        lineas: elegidos.map((c) => ({ empleado_id: c.e.id, sueldo: num(c.f.sueldo), extras: num(c.f.extras), descuentos: num(c.f.descuentos), nota: c.f.nota.trim() || undefined })),
        autor,
      });
      setConfirmar(false);
      setPagada(detalle);
      setNotas("");
      setReferencia("");
      setFilas({});
      await Promise.all([cargarContexto(), alPagar()]);
    } catch (e) {
      setConfirmar(false);
      setAviso({ tono: "error", texto: mensajeDeError(e) });
    } finally {
      setGuardando(false);
    }
  }

  const sinEmpleados = empleados.filter((e) => e.activo).length === 0;

  return (
    <div>
      {sinEmpleados ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-slate-600">Todavia no hay empleados. Agrega a quienes trabajan contigo para poder pagarles.</p>
          <Button className="mt-4" onClick={irAEmpleados}>
            + Agregar empleados
          </Button>
        </Card>
      ) : (
        <>
          <Card className="mb-5 p-4">
            <div className="flex flex-wrap items-end gap-4">
              <Select label="A quienes se paga" value={frecuencia} onChange={(e) => cambiarFrecuencia(e.target.value as FrecuenciaPago)} className="w-44">
                {FRECUENCIAS.map(([k, t]) => (
                  <option key={k} value={k}>
                    {t}
                  </option>
                ))}
              </Select>
              <Input label="Periodo desde" type="date" value={periodo.desde} onChange={(e) => setPeriodo({ ...periodo, desde: e.target.value })} />
              <Input label="Periodo hasta" type="date" value={periodo.hasta} min={periodo.desde} onChange={(e) => setPeriodo({ ...periodo, hasta: e.target.value })} />
              <Input label="Fecha de pago" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          </Card>

          {lista.length === 0 ? (
            <Card className="p-6 text-center text-sm text-slate-500">No hay empleados que se paguen {nombreFrecuencia(frecuencia).toLowerCase()}.</Card>
          ) : (
            <Table columns={["", "Empleado", "Sueldo", "Extras / bonos", "Descuentos", "Neto", "Nota"]}>
              {calculo.map(({ e, f, neto, ya }) =>
                !f ? null : (
                  <tr key={e.id} className={f.incluir ? "" : "bg-slate-50 text-slate-400"}>
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={f.incluir} onChange={(ev) => poner(e.id, { incluir: ev.target.checked })} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-900">{e.nombre}</div>
                      <div className="text-xs text-slate-400">{e.cargo ?? ""}</div>
                      {ya && <div className="text-xs text-amber-600">Ya se le pago hasta el {formatDate(ultimos[e.id].hasta)}</div>}
                    </td>
                    {(["sueldo", "extras", "descuentos"] as const).map((campo) => (
                      <td key={campo} className="px-2 py-2">
                        <input
                          inputMode="decimal"
                          value={f[campo]}
                          placeholder="0"
                          disabled={!f.incluir}
                          onChange={(ev) => poner(e.id, { [campo]: ev.target.value })}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm"
                        />
                      </td>
                    ))}
                    <td className={`whitespace-nowrap px-4 py-2 text-right font-semibold ${neto < 0 ? "text-red-600" : ""}`}>{formatMoney(neto)}</td>
                    <td className="px-2 py-2">
                      <input
                        value={f.nota}
                        placeholder="Ej. adelanto del lunes"
                        disabled={!f.incluir}
                        onChange={(ev) => poner(e.id, { nota: ev.target.value })}
                        className="w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </td>
                  </tr>
                )
              )}
            </Table>
          )}

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <p className="mb-3 text-sm font-semibold text-slate-900">De donde sale el dinero</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select label="Forma de pago" value={metodo} onChange={(e) => setMetodo(e.target.value as typeof metodo)}>
                  {cajaAbierta && <option value="CAJA">Efectivo de la caja abierta ({cajaAbierta.nombre})</option>}
                  <option value="EFECTIVO">Efectivo (no de la caja)</option>
                  <option value="TRANSFERENCIA">Transferencia del banco</option>
                  <option value="CHEQUE">Cheque</option>
                </Select>
                {(metodo === "TRANSFERENCIA" || metodo === "CHEQUE") && (
                  <>
                    <Select label="Banco" value={bancoId} onChange={(e) => setBancoId(e.target.value ? Number(e.target.value) : "")}>
                      <option value="">Banco principal</option>
                      {bancos.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.nombre}
                        </option>
                      ))}
                    </Select>
                    <Input label="Referencia (opcional)" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="No. de transferencia o cheque" />
                  </>
                )}
                <Input label="Nota de la nomina (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} className="sm:col-span-2" />
              </div>
              {metodo === "CAJA" && cajaAbierta && (
                <p className={`mt-3 text-xs ${faltaEfectivo ? "text-red-600" : "text-slate-500"}`}>
                  En la caja deberia haber {formatMoney(cajaAbierta.efectivo)}. {faltaEfectivo ? "No alcanza para esta nomina." : "El pago se anota como una salida en el cierre de caja."}
                </p>
              )}
            </Card>
            <Card className="flex flex-col justify-between p-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total a pagar</p>
                <p className="mt-1.5 text-2xl font-semibold text-slate-900">{formatMoney(total)}</p>
                <p className="mt-1 text-xs text-slate-400">{elegidos.length} empleado(s)</p>
              </div>
              <Button className="mt-4" disabled={!elegidos.length || !(total > 0) || !!faltaEfectivo || hayNegativo || !periodo.desde || !periodo.hasta} onClick={() => setConfirmar(true)}>
                Pagar nomina
              </Button>
            </Card>
          </div>
        </>
      )}

      <Modal open={confirmar} onClose={() => setConfirmar(false)} title="Confirmar el pago">
        <p className="text-sm text-slate-600">
          Vas a pagar <b className="text-slate-900">{formatMoney(total)}</b> a {elegidos.length} empleado(s), del {formatDate(periodo.desde)} al {formatDate(periodo.hasta)}.
          {metodo === "CAJA" ? " Sale del efectivo de la caja abierta." : metodo === "EFECTIVO" ? " Sale del efectivo." : ` Sale del banco por ${METODOS[metodo].toLowerCase()}.`}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmar(false)}>
            Cancelar
          </Button>
          <Button onClick={pagar} disabled={guardando}>
            {guardando ? "Pagando..." : "Pagar"}
          </Button>
        </div>
      </Modal>

      <Modal open={!!pagada} onClose={() => setPagada(null)} title={`Nomina #${pagada?.numero} pagada`}>
        {pagada && (
          <>
            <p className="text-sm text-slate-600">
              Se pagaron <b className="text-slate-900">{formatMoney(pagada.total_neto)}</b> a {pagada.lineas.length} empleado(s). Ya quedo anotado como gasto de sueldos.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => imprimirHtml(`Planilla ${pagada.numero}`, htmlPlanilla(pagada, empresa))}>
                Imprimir planilla
              </Button>
              <Button onClick={() => imprimirHtml(`Recibos nomina ${pagada.numero}`, htmlRecibos(pagada, empresa))}>Imprimir recibos</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function PagosHechos({ empresa, autor, setAviso }: { empresa: string; autor: Autor; setAviso: SetAviso }) {
  const [rango, setRango] = useState(rangoDe("MES"));
  const [pagos, setPagos] = useState<NominaPago[]>([]);
  const [detalle, setDetalle] = useState<NominaDetalle | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  async function cargar() {
    setPagos(await api.nomina.listar({ desde: rango.desde, hasta: rango.hasta }));
  }
  useEffect(() => {
    cargar().catch((e) => setAviso({ tono: "error", texto: mensajeDeError(e) }));
  }, [rango.desde, rango.hasta]);

  const validos = pagos.filter((p) => p.estado === "PAGADA");
  const total = r2(validos.reduce((s, p) => s + p.total_neto, 0));

  async function ver(id: number) {
    setDetalle((await api.nomina.obtener(id)) ?? null);
    setAnulando(false);
    setMotivo("");
  }
  async function anular() {
    if (!detalle) return;
    setTrabajando(true);
    try {
      setDetalle(await api.nomina.anular({ id: detalle.id, motivo, autor }));
      setAnulando(false);
      setAviso({ tono: "ok", texto: `Se anulo la nomina #${detalle.numero}.` });
      await cargar();
    } catch (e) {
      setAviso({ tono: "error", texto: mensajeDeError(e) });
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <RangoFechas desde={rango.desde} hasta={rango.hasta} onChange={setRango} />
      </div>
      <div className="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <StatCard label="Pagado en el periodo" value={formatMoney(total)} hint={`${validos.length} pago(s) de nomina`} />
      </div>
      <Table columns={["No.", "Fecha de pago", "Periodo", "Empleados", "Forma", "Total", "Estado", ""]}>
        {pagos.length === 0 && <EmptyRow colSpan={8} label="Todavia no hay pagos de nomina en estas fechas" />}
        {pagos.map((p) => (
          <tr key={p.id} className="hover:bg-slate-50">
            <td className="px-4 py-2 font-medium">{p.numero}</td>
            <td className="px-4 py-2">{formatDate(p.fecha)}</td>
            <td className="px-4 py-2 text-slate-600">
              {formatDate(p.desde)} al {formatDate(p.hasta)}
            </td>
            <td className="px-4 py-2">{p.empleados}</td>
            <td className="px-4 py-2">{p.caja_sesion_id ? "Caja" : METODOS[p.metodo]}</td>
            <td className="px-4 py-2 text-right font-semibold">{formatMoney(p.total_neto)}</td>
            <td className="px-4 py-2">
              <Badge tone={p.estado === "PAGADA" ? "green" : "red"}>{p.estado === "PAGADA" ? "Pagada" : "Anulada"}</Badge>
            </td>
            <td className="px-4 py-2 text-right">
              <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => ver(p.id)}>
                Ver
              </button>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={`Nomina #${detalle?.numero ?? ""}`} width="max-w-3xl">
        {detalle && (
          <>
            <p className="text-sm text-slate-600">
              Del {formatDate(detalle.desde)} al {formatDate(detalle.hasta)} · pagada el {formatDate(detalle.fecha)} ·{" "}
              {detalle.caja_sesion_id ? "efectivo de la caja" : METODOS[detalle.metodo].toLowerCase()}
              {detalle.banco_nombre ? ` (${detalle.banco_nombre})` : ""}
              {detalle.referencia ? ` · ref. ${detalle.referencia}` : ""}
              {detalle.creado_por ? ` · por ${detalle.creado_por}` : ""}
            </p>
            {detalle.notas && <p className="mt-1 text-xs text-slate-500">{detalle.notas}</p>}
            <div className="mt-4">
              <Table columns={["Empleado", "Sueldo", "Extras", "Descuentos", "Neto"]}>
                {detalle.lineas.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{l.empleado_nombre}</div>
                      {l.nota && <div className="text-xs text-slate-400">{l.nota}</div>}
                    </td>
                    <td className="px-4 py-2 text-right">{formatMoney(l.sueldo)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(l.extras)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(l.descuentos)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatMoney(l.neto)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right">{formatMoney(detalle.total_sueldos)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(detalle.total_extras)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(detalle.total_descuentos)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(detalle.total_neto)}</td>
                </tr>
              </Table>
            </div>
            {anulando ? (
              <div className="mt-4 rounded-lg bg-red-50 p-3">
                <Input label="Por que se anula" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. se pago dos veces" />
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setAnulando(false)}>
                    No anular
                  </Button>
                  <Button variant="danger" onClick={anular} disabled={!motivo.trim() || trabajando}>
                    {trabajando ? "Anulando..." : "Anular nomina"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {detalle.estado === "PAGADA" && (
                  <Button variant="danger" onClick={() => setAnulando(true)}>
                    Anular
                  </Button>
                )}
                <Button variant="secondary" onClick={() => imprimirHtml(`Planilla ${detalle.numero}`, htmlPlanilla(detalle, empresa))}>
                  Imprimir planilla
                </Button>
                <Button onClick={() => imprimirHtml(`Recibos nomina ${detalle.numero}`, htmlRecibos(detalle, empresa))}>Imprimir recibos</Button>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

const VACIO: EmpleadoInput = { nombre: "", cedula: "", cargo: "", telefono: "", frecuencia: "SEMANAL", sueldo: 0, fecha_ingreso: "", notas: "" };

function Empleados({ empleados, recargar, setAviso }: { empleados: Empleado[]; recargar: () => Promise<void>; setAviso: SetAviso }) {
  const [editando, setEditando] = useState<(EmpleadoInput & { sueldoTexto: string }) | null>(null);
  const [aBorrar, setABorrar] = useState<Empleado | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  function nuevo() {
    setError("");
    setEditando({ ...VACIO, sueldoTexto: "" });
  }
  function editar(e: Empleado) {
    setError("");
    setEditando({ id: e.id, nombre: e.nombre, cedula: e.cedula ?? "", cargo: e.cargo ?? "", telefono: e.telefono ?? "", frecuencia: e.frecuencia, sueldo: e.sueldo, fecha_ingreso: e.fecha_ingreso ?? "", notas: e.notas ?? "", activo: e.activo, sueldoTexto: String(e.sueldo) });
  }
  async function guardar() {
    if (!editando) return;
    setGuardando(true);
    setError("");
    try {
      const { sueldoTexto, ...datos } = editando;
      await api.empleados.guardar({ ...datos, sueldo: num(sueldoTexto) });
      setEditando(null);
      await recargar();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }
  async function cambiarActivo(e: Empleado) {
    try {
      await api.empleados.guardar({ id: e.id, nombre: e.nombre, cedula: e.cedula, cargo: e.cargo, telefono: e.telefono, frecuencia: e.frecuencia, sueldo: e.sueldo, fecha_ingreso: e.fecha_ingreso, notas: e.notas, activo: e.activo ? 0 : 1 });
      await recargar();
    } catch (err) {
      setAviso({ tono: "error", texto: mensajeDeError(err) });
    }
  }
  async function borrar() {
    if (!aBorrar) return;
    try {
      const r = await api.empleados.eliminar(aBorrar.id);
      setAviso({ tono: "ok", texto: r.borrado ? `Se borro a ${aBorrar.nombre}.` : `${aBorrar.nombre} ya tiene pagos, asi que quedo desactivado para conservar el historial.` });
      await recargar();
    } catch (err) {
      setAviso({ tono: "error", texto: mensajeDeError(err) });
    } finally {
      setABorrar(null);
    }
  }
  const poner = (c: Partial<EmpleadoInput & { sueldoTexto: string }>) => setEditando((p) => (p ? { ...p, ...c } : p));

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={nuevo}>+ Nuevo empleado</Button>
      </div>
      <Table columns={["Empleado", "Cargo", "Se le paga", "Sueldo", "Estado", ""]}>
        {empleados.length === 0 && <EmptyRow colSpan={6} label="Todavia no hay empleados" />}
        {empleados.map((e) => (
          <tr key={e.id} className={e.activo ? "" : "text-slate-400"}>
            <td className="px-4 py-2">
              <div className="font-medium text-slate-900">{e.nombre}</div>
              <div className="text-xs text-slate-400">{[e.cedula, e.telefono].filter(Boolean).join(" · ")}</div>
            </td>
            <td className="px-4 py-2">{e.cargo ?? ""}</td>
            <td className="px-4 py-2">{nombreFrecuencia(e.frecuencia)}</td>
            <td className="px-4 py-2 text-right font-medium">{formatMoney(e.sueldo)}</td>
            <td className="px-4 py-2">
              <Badge tone={e.activo ? "green" : "slate"}>{e.activo ? "Activo" : "Inactivo"}</Badge>
            </td>
            <td className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium">
              <button className="text-brand-600 hover:underline" onClick={() => editar(e)}>
                Editar
              </button>
              <button className="ml-3 text-slate-500 hover:underline" onClick={() => cambiarActivo(e)}>
                {e.activo ? "Desactivar" : "Reactivar"}
              </button>
              <button className="ml-3 text-red-600 hover:underline" onClick={() => setABorrar(e)}>
                Borrar
              </button>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={!!editando} onClose={() => setEditando(null)} title={editando?.id ? "Editar empleado" : "Nuevo empleado"}>
        {editando && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Nombre" value={editando.nombre} onChange={(e) => poner({ nombre: e.target.value })} className="" autoFocus />
            <Input label="Cargo (opcional)" value={editando.cargo ?? ""} onChange={(e) => poner({ cargo: e.target.value })} placeholder="Ej. Cocinera, Cajero" />
            <Select label="Cada cuanto se le paga" value={editando.frecuencia} onChange={(e) => poner({ frecuencia: e.target.value as FrecuenciaPago })}>
              {FRECUENCIAS.map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </Select>
            <Input label={`Sueldo ${editando.frecuencia === "SEMANAL" ? "por semana" : editando.frecuencia === "QUINCENAL" ? "por quincena" : "por mes"}`} inputMode="decimal" value={editando.sueldoTexto} onChange={(e) => poner({ sueldoTexto: e.target.value })} placeholder="0.00" />
            <Input label="Cedula (opcional)" value={editando.cedula ?? ""} onChange={(e) => poner({ cedula: e.target.value })} />
            <Input label="Telefono (opcional)" value={editando.telefono ?? ""} onChange={(e) => poner({ telefono: e.target.value })} />
            <Input label="Fecha de ingreso (opcional)" type="date" value={editando.fecha_ingreso ?? ""} onChange={(e) => poner({ fecha_ingreso: e.target.value })} />
            <Input label="Notas (opcional)" value={editando.notas ?? ""} onChange={(e) => poner({ notas: e.target.value })} />
            {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
            <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
              <Button variant="secondary" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
              <Button onClick={guardar} disabled={guardando || !editando.nombre.trim()}>
                {guardando ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!aBorrar} onClose={() => setABorrar(null)} title="Borrar empleado">
        <p className="text-sm text-slate-600">
          Vas a borrar a <b className="text-slate-900">{aBorrar?.nombre}</b>. Si ya se le pago alguna vez, no se borra: queda desactivado para conservar los recibos.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setABorrar(null)}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={borrar}>
            Borrar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
