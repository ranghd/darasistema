import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, mensajeDeError } from "../../lib/api";
import { formatDate, formatMoney } from "../../lib/format";
import { avisoDeResultado, type AvisoImpresion } from "../../lib/ticket";
import type { EcfAjustes, EcfEstado, EcfPrueba, EcfRango, EcfSinEmitir } from "../../lib/types";
import { useAuth } from "../../lib/auth";
import { Button, Card, Modal, PageHeader } from "../../components/ui";

// Panel sencillo de la factura electronica para quien atiende la caja: se ve si todo esta bien,
// se puede hacer una prueba (sin tocar inventario ni dinero) y se ve lo que no salio.
// Nada de terminos tecnicos: lo dudoso lo resuelve el administrador.

const TEXTO_ESTADO: Record<string, string> = {
  PENDIENTE: "No salió. Avisa al administrador.",
  ERROR: "No salió. Avisa al administrador.",
  INCIERTO: "No se sabe si salió. Avisa al administrador.",
  RECHAZADO: "La DGII no la aceptó. Avisa al administrador.",
};

function htmlRecibo(numero: string | null, anchoMm: number): string {
  const ahora = new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}body{width:${anchoMm <= 58 ? 46 : 68}mm;margin:0;padding:2mm 0 6mm 1mm;font-family:Arial,sans-serif;font-size:12px;color:#000;text-align:center}</style></head><body>
    <div style="font-weight:700;font-size:14px">PRUEBA DE FACTURA ELECTRÓNICA</div>
    <div style="font-weight:700;border:1px solid #000;padding:3px;margin:6px 0">SIN VALOR FISCAL</div>
    <div>${numero ?? ""}</div><div>${ahora}</div>
    <div style="margin-top:6px">Si ves este papel, la impresora y la conexión funcionan.</div></body></html>`;
}

const MODOS = [
  { id: "apagado", titulo: "Apagada", texto: "Se factura como siempre.", color: "border-slate-400 bg-slate-50 text-slate-800" },
  { id: "prueba", titulo: "Prueba", texto: "Las ventas salen normales y se manda una factura de práctica.", color: "border-amber-400 bg-amber-50 text-amber-900" },
  { id: "real", titulo: "Real", texto: "Cada venta sale como factura electrónica ante la DGII.", color: "border-emerald-500 bg-emerald-50 text-emerald-900" },
] as const;

export default function FacturaElectronica() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "ADMIN";
  const [ajustes, setAjustes] = useState<EcfAjustes | null>(null);
  const [rangos, setRangos] = useState<EcfRango[] | null>(null);
  const [errorRangos, setErrorRangos] = useState("");
  const [confirmarReal, setConfirmarReal] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [errorModo, setErrorModo] = useState("");
  const [estado, setEstado] = useState<EcfEstado | null>(null);
  const [sinEmitir, setSinEmitir] = useState<EcfSinEmitir[]>([]);
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<EcfPrueba | null>(null);
  const [aviso, setAviso] = useState<AvisoImpresion | null>(null);

  async function cargar() {
    setEstado((await api.ecf.estado().catch(() => ({ modo: "apagado" }))) as EcfEstado);
    setSinEmitir((await api.ecf.sinEmitir().catch(() => [])) as EcfSinEmitir[]);
    // solo el administrador puede pedirlo (a la caja la nube le diria que no y saldria como error de conexion)
    if (esAdmin) {
      setAjustes((await api.ecf.ajustes().catch(() => null)) as EcfAjustes | null);
      try {
        setRangos((await api.ecf.rangos()) as EcfRango[]);
        setErrorRangos("");
      } catch (e) {
        setErrorRangos(mensajeDeError(e, "No se pudieron leer los rangos"));
      }
    }
  }

  async function cambiarModo(modo: string) {
    setCambiando(true);
    setErrorModo("");
    try {
      await api.ecf.cambiarModo({ modo });
      setConfirmarReal(false);
    } catch (e) {
      setErrorModo(mensajeDeError(e, "No se pudo cambiar el modo"));
      setConfirmarReal(false);
    } finally {
      setCambiando(false);
      await cargar();
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  async function hacerPrueba() {
    setProbando(true);
    setPrueba(null);
    setAviso(null);
    try {
      setPrueba(await api.ecf.probar());
    } catch (e) {
      setPrueba({ ok: false, mensaje: mensajeDeError(e, "No se pudo hacer la prueba. Avisa al administrador."), numero: null });
    } finally {
      setProbando(false);
    }
  }

  async function imprimirPrueba() {
    try {
      const cfg = await api.impresion.obtenerConfig();
      setAviso(avisoDeResultado(await api.impresion.imprimirTicket(htmlRecibo(prueba?.numero ?? null, cfg.anchoMm))));
    } catch (e) {
      setAviso({ ok: false, texto: `No se imprimió: ${mensajeDeError(e, "error desconocido")}` });
    }
  }

  const modo = estado?.modo ?? "apagado";
  const hayProblemas = modo === "real" && sinEmitir.length > 0;
  const semaforo = hayProblemas
    ? { color: "bg-red-500", titulo: sinEmitir.length === 1 ? "Hay 1 factura que no salió" : `Hay ${sinEmitir.length} facturas que no salieron`, texto: "Mira la lista de abajo y avisa al administrador. No vuelvas a hacer la venta." }
    : modo === "real"
      ? { color: "bg-emerald-500", titulo: "Funcionando", texto: "Cada venta sale con su factura electrónica." }
      : modo === "prueba"
        ? { color: "bg-amber-400", titulo: "Modo prueba", texto: "Los comprobantes son de práctica: no valen ante la DGII." }
        : { color: "bg-slate-400", titulo: "Apagada", texto: "Por ahora se factura como siempre." };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Factura electrónica" subtitle="Aquí ves si todo está bien y puedes hacer una prueba" />

      <Card className="mb-5 p-5">
        <div className="flex items-center gap-4">
          <span className={`h-10 w-10 shrink-0 rounded-full ${semaforo.color}`} />
          <div>
            <p className="text-xl font-bold text-slate-800">{semaforo.titulo}</p>
            <p className="text-slate-600">{semaforo.texto}</p>
          </div>
        </div>
      </Card>

      {esAdmin && (
        <Card className="mb-5 p-5">
          <h2 className="text-lg font-semibold text-slate-800">Modo de la factura electrónica</h2>
          <p className="mb-4 text-slate-600">Solo el administrador ve esto. Toca la opción que quieres usar.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {MODOS.map((m) => {
              const activo = modo === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={cambiando || activo || (m.id !== "apagado" && ajustes?.listo === false)}
                  onClick={() => (m.id === "real" ? setConfirmarReal(true) : cambiarModo(m.id))}
                  className={`rounded-xl border-2 p-4 text-left transition disabled:cursor-default ${activo ? m.color : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 disabled:opacity-50"}`}
                >
                  <span className="block text-lg font-bold">
                    {m.titulo}
                    {activo ? " ✔" : ""}
                  </span>
                  <span className="block text-sm">{m.texto}</span>
                </button>
              );
            })}
          </div>
          {ajustes && ajustes.falta.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">Todavía no se puede encender: falta {ajustes.falta.join(", ")}. Avisa a Darasistema.</p>}
          {errorModo && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{errorModo}</p>}
        </Card>
      )}

      {esAdmin && (
        <Card className="mb-5 p-5">
          <h2 className="text-lg font-semibold text-slate-800">Números de la factura electrónica (E)</h2>
          <p className="mb-3 text-slate-600">Son los números que la DGII le autorizó a Damian. Se guardan en ef2 y aquí los ves.</p>
          {errorRangos && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{errorRangos}</p>}
          {rangos && rangos.length === 0 && <p className="text-slate-600">ef2 no tiene ningún rango cargado todavía.</p>}
          <ul className="divide-y divide-slate-100">
            {(rangos ?? []).map((r) => {
              const pocos = r.disponibles <= 20 || r.porcentajeUso >= 80;
              return (
                <li key={`${r.prefijo}-${r.desde}`} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">
                      {r.prefijo} <span className="font-normal text-slate-600">· {r.nombre}</span>
                    </span>
                    <span className={pocos ? "font-semibold text-red-700" : "text-slate-700"}>
                      Quedan {r.disponibles.toLocaleString("es-DO")} de {(r.hasta - r.desde + 1).toLocaleString("es-DO")}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full ${pocos ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, Math.max(2, r.porcentajeUso))}%` }} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Del {r.prefijo}{String(r.desde).padStart(10, "0")} al {r.prefijo}{String(r.hasta).padStart(10, "0")} · {r.vence ? `válido en ef2 hasta el ${formatDate(r.vence)}` : "sin fecha en ef2"}
                    {!r.activo && " · inactivo"}
                  </p>
                  {pocos && <p className="text-sm font-medium text-red-700">Quedan pocos: pide otro rango a la DGII antes de que se acaben.</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Modal open={confirmarReal} onClose={() => setConfirmarReal(false)} title="Pasar a factura electrónica real">
        <p className="text-slate-700">
          Desde este momento <b>cada venta saldrá como factura electrónica real</b> ante la DGII y gastará un número de la secuencia autorizada.
        </p>
        <ul className="my-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Antes, todas las cajas deben tener la versión 1.0.51 o más nueva.</li>
          <li>Haz primero una prueba en la caja y revisa que salió bien.</li>
          <li>Se puede volver a Prueba o a Apagada cuando quieras.</li>
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmarReal(false)}>
            Cancelar
          </Button>
          <Button variant="danger" disabled={cambiando} onClick={() => cambiarModo("real")}>
            {cambiando ? "Cambiando..." : "Sí, pasar a real"}
          </Button>
        </div>
      </Modal>

      <Card className="mb-5 p-5">
        <h2 className="text-lg font-semibold text-slate-800">Hacer una prueba</h2>
        <p className="mb-4 text-slate-600">Manda una factura de práctica para ver si todo está bien. No descuenta inventario ni mueve el dinero de la caja.</p>
        <Button onClick={hacerPrueba} disabled={probando}>
          {probando ? "Probando..." : "Hacer prueba"}
        </Button>
        {prueba && (
          <div className={`mt-4 rounded-lg px-4 py-3 ${prueba.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
            <p className="text-lg font-semibold">{prueba.ok ? "✔ Todo bien" : "✖ Algo falló"}</p>
            <p>{prueba.mensaje}</p>
            {prueba.ok && prueba.numero && <p className="mt-1 text-sm">Número de prueba: {prueba.numero}</p>}
            {prueba.ok && (
              <div className="mt-3">
                <Button variant="secondary" onClick={imprimirPrueba}>
                  Imprimir recibo de prueba
                </Button>
              </div>
            )}
          </div>
        )}
        {aviso && <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{aviso.texto}</p>}
      </Card>

      {(modo === "real" || sinEmitir.length > 0) && (
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-800">Facturas que no salieron</h2>
          </div>
          {sinEmitir.length === 0 ? (
            <p className="text-emerald-700">✔ Todas las facturas salieron bien.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sinEmitir.map((x) => (
                <li key={`${x.factura_id}-${x.clase}`} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">
                      {x.clase === "NOTA_CREDITO" ? "Anulación de la factura" : "Factura"}{" "}
                      <Link className="underline" to={`/facturas/${x.factura_id}`}>
                        #{x.factura_numero}
                      </Link>
                    </span>
                    <span className="text-slate-600">
                      {formatMoney(x.factura_total)} · {formatDate(x.factura_fecha)}
                    </span>
                  </div>
                  <p className="text-red-700">{TEXTO_ESTADO[x.estado] ?? "Avisa al administrador."}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
