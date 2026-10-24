import { useEffect, useMemo, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import { formatDate, formatMoney } from "../../lib/format";
import { aMovimientos, leerEstado, type EstadoLeido, type Mapeo } from "../../lib/estadoCuenta";
import type { Banco, Cuenta, DatosConciliacion, LineaLibroBanco, MovimientoBanco } from "../../lib/types";
import { Badge, Button, Card, Input, Modal, PageHeader, Select, StatCard } from "../../components/ui";
import { RangoFechas, rangoDe } from "../../components/reportes";

const montoColor = (m: number) => (m >= 0 ? "text-emerald-600" : "text-red-600");

export default function Conciliacion() {
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [bancoId, setBancoId] = useState<number | null>(null);
  const [rango, setRango] = useState(rangoDe("MES"));
  const [datos, setDatos] = useState<DatosConciliacion | null>(null);
  const [importar, setImportar] = useState(false);
  const [nuevoBanco, setNuevoBanco] = useState(false);
  const [registrar, setRegistrar] = useState<MovimientoBanco | null>(null);
  const [enlazar, setEnlazar] = useState<MovimientoBanco | null>(null);
  const [aviso, setAviso] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);

  async function cargarBancos(elegir?: number) {
    const b = await api.bancos.listar();
    setBancos(b);
    setBancoId((actual) => elegir ?? actual ?? b[0]?.id ?? null);
  }
  async function cargar() {
    if (!bancoId) return;
    setDatos(await api.conciliacion.datos(bancoId, rango.desde, rango.hasta));
  }
  useEffect(() => {
    cargarBancos();
  }, []);
  useEffect(() => {
    cargar();
  }, [bancoId, rango.desde, rango.hasta]);

  async function auto() {
    if (!bancoId) return;
    const n = await api.conciliacion.auto(bancoId);
    setAviso(n ? `Se conciliaron ${n} movimiento${n === 1 ? "" : "s"} mas.` : "No se encontraron mas parejas con el mismo monto y fecha cercana.");
    cargar();
  }

  const movs = (datos?.movimientos ?? []).filter((m) => !soloPendientes || !m.asiento_linea_id);
  const libros = (datos?.libros ?? []).filter((l) => !soloPendientes || !l.movimiento_id);
  const res = datos?.resumen;

  return (
    <div>
      <PageHeader
        title="Bancos y conciliacion"
        subtitle="Cuadra lo que dice tu banco con lo que registraste en el sistema"
        actions={
          <>
            <Button variant="secondary" onClick={() => setNuevoBanco(true)}>
              + Agregar banco
            </Button>
            <Button variant="secondary" onClick={auto} disabled={!bancoId}>
              Conciliar automatico
            </Button>
            <Button onClick={() => setImportar(true)} disabled={!bancoId}>
              Importar estado de cuenta
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {bancos.map((b) => (
          <button
            key={b.id}
            onClick={() => setBancoId(b.id)}
            className={`rounded-xl px-4 py-2 text-left text-sm ring-1 ${b.id === bancoId ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}
          >
            <span className="block font-semibold">{b.nombre}</span>
            <span className={`text-xs ${b.id === bancoId ? "text-white/80" : "text-slate-400"}`}>
              {b.numero_cuenta ? `Cta. ${b.numero_cuenta} · ` : ""}
              {formatMoney(b.saldo_libros)}
            </span>
          </button>
        ))}
      </div>
      <div className="mb-5">
        <RangoFechas desde={rango.desde} hasta={rango.hasta} onChange={setRango} />
      </div>

      {res && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatCard label="Saldo segun el sistema" value={formatMoney(res.saldo_libros)} tone="blue" hint={`Al ${formatDate(datos!.hasta)}`} />
          <StatCard label="Conciliados" value={String(res.conciliados)} tone="green" />
          <StatCard label="En el banco, no en el sistema" value={String(res.solo_banco)} tone={res.solo_banco ? "red" : "slate"} hint={res.solo_banco ? formatMoney(res.solo_banco_monto) : "Todo explicado"} />
          <StatCard label="En el sistema, no en el banco" value={String(res.solo_libros)} tone={res.solo_libros ? "amber" : "slate"} hint={res.solo_libros ? formatMoney(res.solo_libros_monto) : "Todo llego al banco"} />
        </div>
      )}

      {aviso && <p className="mb-4 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{aviso}</p>}

      {datos && datos.movimientos.length === 0 && (
        <Card className="mb-5 p-5 text-sm text-slate-600">
          <p className="mb-2 font-semibold text-slate-800">Como se cuadra con el banco</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Cuando cobres por transferencia, anota el numero de referencia y el banco donde entro el dinero.</li>
            <li>Entra a la pagina de tu banco y baja el estado de cuenta del mes (en Excel o CSV).</li>
            <li>
              Pulsa <b>Importar estado de cuenta</b>: copia las filas del Excel y pegalas, o elige el archivo CSV.
            </li>
            <li>El sistema cruza solo cada movimiento del banco con su cobro o pago. Lo que no cuadre te lo marca para que lo revises.</li>
          </ol>
        </Card>
      )}

      <label className="mb-2 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} /> Ver solo lo que falta por cuadrar
      </label>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700">Lo que dice el banco (estado de cuenta)</div>
          <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
            {movs.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">Sin movimientos importados en este periodo</p>}
            {movs.map((m) => (
              <div key={m.id} className={`flex items-start gap-3 px-4 py-2.5 text-sm ${m.asiento_linea_id ? "" : "bg-red-50/40"}`}>
                <div className="w-20 shrink-0 text-xs text-slate-500">{formatDate(m.fecha)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-slate-800">{m.descripcion || "(sin descripcion)"}</p>
                  {m.asiento_linea_id ? (
                    <p className="truncate text-xs text-emerald-600">✓ {m.asiento_concepto}</p>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <button className="font-medium text-brand-600 hover:underline" onClick={() => setEnlazar(m)}>
                        Buscar en el sistema
                      </button>
                      <button className="font-medium text-brand-600 hover:underline" onClick={() => setRegistrar(m)}>
                        {m.monto < 0 ? "Registrar como gasto o cargo" : "Registrar ingreso"}
                      </button>
                      <button
                        className="text-slate-400 hover:text-red-500"
                        onClick={async () => {
                          await api.conciliacion.eliminar(m.id);
                          cargar();
                        }}
                      >
                        Quitar
                      </button>
                    </div>
                  )}
                </div>
                <div className={`shrink-0 text-right font-semibold ${montoColor(m.monto)}`}>
                  {formatMoney(m.monto)}
                  {m.asiento_linea_id ? (
                    <button
                      className="block text-xs font-normal text-slate-400 hover:text-red-500"
                      onClick={async () => {
                        await api.conciliacion.desenlazar(m.id);
                        cargar();
                      }}
                    >
                      deshacer
                    </button>
                  ) : (
                    <Badge tone="red">Sin cuadrar</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700">Lo que registraste en el sistema</div>
          <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
            {libros.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">Sin movimientos de este banco en el periodo</p>}
            {libros.map((l) => (
              <div key={l.id} className={`flex items-start gap-3 px-4 py-2.5 text-sm ${l.movimiento_id ? "" : "bg-amber-50/50"}`}>
                <div className="w-20 shrink-0 text-xs text-slate-500">{formatDate(l.fecha)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-slate-800">{l.concepto}</p>
                  <p className="truncate text-xs text-slate-400">
                    Asiento #{l.asiento_numero}
                    {l.referencia ? ` · Ref. ${l.referencia}` : ""}
                  </p>
                </div>
                <div className={`shrink-0 text-right font-semibold ${montoColor(l.monto)}`}>
                  {formatMoney(l.monto)}
                  <span className="block">{l.movimiento_id ? <span className="text-xs font-normal text-emerald-600">✓ en el banco</span> : <Badge tone="amber">No aparece</Badge>}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {bancoId && (
        <ImportarModal
          open={importar}
          banco={bancos.find((b) => b.id === bancoId)!}
          onClose={() => setImportar(false)}
          onImportado={(t) => {
            setAviso(t);
            cargar();
            cargarBancos();
          }}
        />
      )}
      <NuevoBancoModal open={nuevoBanco} onClose={() => setNuevoBanco(false)} onCreado={(id) => cargarBancos(id)} />
      <RegistrarModal mov={registrar} onClose={() => setRegistrar(null)} onHecho={cargar} />
      <EnlazarModal mov={enlazar} libros={(datos?.libros ?? []).filter((l) => !l.movimiento_id)} onClose={() => setEnlazar(null)} onHecho={cargar} />
    </div>
  );
}

function ImportarModal({ open, banco, onClose, onImportado }: { open: boolean; banco: Banco; onClose: () => void; onImportado: (texto: string) => void }) {
  const [texto, setTexto] = useState("");
  const [leido, setLeido] = useState<EstadoLeido | null>(null);
  const [mapeo, setMapeo] = useState<Mapeo | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (open) {
      setTexto("");
      setLeido(null);
      setMapeo(null);
      setError("");
    }
  }, [open]);

  function analizar(t: string) {
    setTexto(t);
    setError("");
    if (!t.trim()) return setLeido(null);
    const e = leerEstado(t);
    setLeido(e);
    setMapeo(e.mapeo);
  }

  const resultado = useMemo(() => (leido && mapeo ? aMovimientos(leido, mapeo) : null), [leido, mapeo]);

  async function confirmar() {
    if (!resultado?.movimientos.length) return setError("No se encontro ningun movimiento con fecha y monto. Revisa las columnas.");
    setGuardando(true);
    try {
      const r = await api.conciliacion.importar(banco.id, resultado.movimientos);
      onImportado(`Se importaron ${r.nuevos} movimientos${r.repetidos ? ` (${r.repetidos} ya estaban)` : ""} y se conciliaron ${r.conciliados} solos.`);
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  const columna = (k: keyof Mapeo, etiqueta: string) => (
    <Select label={etiqueta} value={mapeo?.[k] ?? -1} onChange={(e) => setMapeo((m) => (m ? { ...m, [k]: Number(e.target.value) } : m))}>
      <option value={-1}>(ninguna)</option>
      {leido?.encabezados.map((h, i) => (
        <option key={i} value={i}>
          {h || `Columna ${i + 1}`}
        </option>
      ))}
    </Select>
  );

  return (
    <Modal open={open} onClose={onClose} title={`Importar estado de cuenta · ${banco?.nombre ?? ""}`} width="max-w-4xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Abre en Excel el estado de cuenta que bajaste del banco, selecciona las filas (con los titulos) y pegalas aqui. Tambien puedes elegir un archivo CSV.
        </p>
        <textarea
          value={texto}
          onChange={(e) => analizar(e.target.value)}
          placeholder={"Fecha\tDescripcion\tReferencia\tDebito\tCredito\n23/10/2026\tTRANSFERENCIA RECIBIDA\t778899\t\t2,000.00"}
          className="h-32 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs"
        />
        <input
          type="file"
          accept=".csv,.txt"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) analizar(await f.text());
          }}
          className="text-sm"
        />
        {leido && mapeo && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              {columna("fecha", "Fecha")}
              {columna("descripcion", "Descripcion")}
              {columna("referencia", "Referencia")}
              {columna("monto", "Monto (+/-)")}
              {columna("debito", "Debito (sale)")}
              {columna("credito", "Credito (entra)")}
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Fecha</th>
                    <th className="px-3 py-1.5 text-left">Descripcion</th>
                    <th className="px-3 py-1.5 text-left">Referencia</th>
                    <th className="px-3 py-1.5 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado?.movimientos.slice(0, 50).map((m, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-1">{formatDate(m.fecha)}</td>
                      <td className="px-3 py-1">{m.descripcion}</td>
                      <td className="px-3 py-1 font-mono">{m.referencia}</td>
                      <td className={`px-3 py-1 text-right font-medium ${montoColor(m.monto)}`}>{formatMoney(m.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              {resultado?.movimientos.length ?? 0} movimientos listos{resultado?.descartadas ? ` · ${resultado.descartadas} filas sin fecha o monto se ignoran` : ""}. Si salen al reves (entradas como salidas),
              revisa las columnas de debito y credito.
            </p>
          </>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={guardando || !resultado?.movimientos.length}>
            {guardando ? "Importando..." : `Importar ${resultado?.movimientos.length ?? 0} movimientos`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function NuevoBancoModal({ open, onClose, onCreado }: { open: boolean; onClose: () => void; onCreado: (id: number) => void }) {
  const [nombre, setNombre] = useState("");
  const [numero, setNumero] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) (setNombre(""), setNumero(""), setError(""));
  }, [open]);
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    try {
      const b = await api.bancos.crear({ nombre, numero_cuenta: numero });
      onCreado(b.id);
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Agregar cuenta de banco">
      <form onSubmit={crear} className="space-y-3">
        <Input label="Banco" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Popular, BHD, Banreservas" autoFocus required />
        <Input label="Numero de cuenta (opcional)" value={numero} onChange={(e) => setNumero(e.target.value)} />
        <p className="text-xs text-slate-500">Se le crea su propia cuenta en el catalogo contable.</p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit">Agregar</Button>
        </div>
      </form>
    </Modal>
  );
}

function RegistrarModal({ mov, onClose, onHecho }: { mov: MovimientoBanco | null; onClose: () => void; onHecho: () => void }) {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cuentaId, setCuentaId] = useState<number | "">("");
  const [concepto, setConcepto] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!mov) return;
    setConcepto(mov.descripcion ?? "");
    setError("");
    api.cuentas.listar().then((c) => {
      const tipos = mov.monto < 0 ? ["GASTOS", "PASIVO", "ACTIVO"] : ["INGRESOS", "ACTIVO", "PASIVO", "PATRIMONIO"];
      const lista = (c as Cuenta[]).filter((x) => x.es_movimiento && x.activo && tipos.includes(x.tipo)).sort((a, b) => tipos.indexOf(a.tipo) - tipos.indexOf(b.tipo) || a.codigo.localeCompare(b.codigo));
      setCuentas(lista);
      const sugerida = lista.find((x) => (mov.monto < 0 ? /bancari|comision/i.test(x.nombre) : /otros ingresos|interes/i.test(x.nombre))) ?? lista[0];
      setCuentaId(sugerida?.id ?? "");
    });
  }, [mov?.id]);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!mov || !cuentaId) return;
    try {
      await api.conciliacion.registrar({ movimiento_id: mov.id, cuenta_id: Number(cuentaId), concepto });
      onHecho();
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }
  return (
    <Modal open={!!mov} onClose={onClose} title={mov && mov.monto < 0 ? "Registrar cargo del banco" : "Registrar entrada al banco"}>
      <form onSubmit={guardar} className="space-y-3">
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          {mov && formatDate(mov.fecha)} · {mov?.descripcion} · <b className={montoColor(mov?.monto ?? 0)}>{formatMoney(mov?.monto)}</b>
        </p>
        <Select label="¿A que cuenta va?" value={cuentaId} onChange={(e) => setCuentaId(Number(e.target.value))}>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.codigo} · {c.nombre}
            </option>
          ))}
        </Select>
        <Input label="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        <p className="text-xs text-slate-500">Ejemplo: comisiones y cargos del banco van a Gastos Bancarios. Si es un cobro de un cliente, mejor registralo en Cuentas por Cobrar y luego enlazalo.</p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit">Registrar y cuadrar</Button>
        </div>
      </form>
    </Modal>
  );
}

function EnlazarModal({ mov, libros, onClose, onHecho }: { mov: MovimientoBanco | null; libros: LineaLibroBanco[]; onClose: () => void; onHecho: () => void }) {
  const [error, setError] = useState("");
  useEffect(() => setError(""), [mov?.id]);
  const candidatos = mov ? libros.filter((l) => Math.abs(l.monto - mov.monto) < 0.01) : [];
  const otros = mov ? libros.filter((l) => Math.abs(l.monto - mov.monto) >= 0.01 && Math.sign(l.monto) === Math.sign(mov.monto)) : [];
  async function elegir(l: LineaLibroBanco) {
    if (!mov) return;
    try {
      await api.conciliacion.enlazar(mov.id, l.id);
      onHecho();
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }
  const fila = (l: LineaLibroBanco, ok: boolean) => (
    <button key={l.id} disabled={!ok} onClick={() => elegir(l)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${ok ? "hover:bg-brand-50" : "cursor-not-allowed opacity-50"}`}>
      <span>
        <span className="text-xs text-slate-500">{formatDate(l.fecha)}</span> · {l.concepto}
        {l.referencia ? <span className="text-xs text-slate-400"> · Ref. {l.referencia}</span> : null}
      </span>
      <span className={`font-semibold ${montoColor(l.monto)}`}>{formatMoney(l.monto)}</span>
    </button>
  );
  return (
    <Modal open={!!mov} onClose={onClose} title="¿Con cual movimiento del sistema cuadra?" width="max-w-2xl">
      <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        Banco: {mov && formatDate(mov.fecha)} · {mov?.descripcion} · <b className={montoColor(mov?.monto ?? 0)}>{formatMoney(mov?.monto)}</b>
      </p>
      {candidatos.length > 0 ? (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Mismo monto</p>
          {candidatos.map((l) => fila(l, true))}
        </div>
      ) : (
        <p className="mb-3 text-sm text-slate-500">No hay nada sin cuadrar con ese mismo monto. Si es un cobro o pago que no registraste, registralo primero y vuelve aqui.</p>
      )}
      {otros.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Otros sin cuadrar (montos distintos)</p>
          {otros.slice(0, 15).map((l) => fila(l, false))}
        </div>
      )}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}
