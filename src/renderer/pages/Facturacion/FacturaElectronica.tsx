import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, mensajeDeError } from "../../lib/api";
import { formatDate, formatMoney } from "../../lib/format";
import { avisoDeResultado, type AvisoImpresion } from "../../lib/ticket";
import type { EcfEstado, EcfPrueba, EcfSinEmitir } from "../../lib/types";
import { Button, Card, PageHeader } from "../../components/ui";

// Panel sencillo de la factura electronica para quien atiende la caja: se ve si todo esta bien,
// se puede hacer una prueba (sin tocar inventario ni dinero) y se reintenta lo que no salio.
// Nada de terminos tecnicos: lo dudoso lo resuelve el administrador.

const TEXTO_ESTADO: Record<string, string> = {
  PENDIENTE: "No se pudo enviar. Toca Reintentar.",
  ERROR: "No se pudo enviar. Toca Reintentar.",
  INCIERTO: "No se sabe si salió. Avisa al administrador antes de volver a intentar.",
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

export default function FacturaElectronica() {
  const [estado, setEstado] = useState<EcfEstado | null>(null);
  const [sinEmitir, setSinEmitir] = useState<EcfSinEmitir[]>([]);
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<EcfPrueba | null>(null);
  const [aviso, setAviso] = useState<AvisoImpresion | null>(null);
  const [reintentando, setReintentando] = useState(false);
  const [resultadoReintento, setResultadoReintento] = useState("");

  async function cargar() {
    setEstado((await api.ecf.estado().catch(() => ({ modo: "apagado" }))) as EcfEstado);
    setSinEmitir((await api.ecf.sinEmitir().catch(() => [])) as EcfSinEmitir[]);
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

  async function reintentarTodas() {
    setReintentando(true);
    setResultadoReintento("");
    try {
      const r = await api.ecf.reintentarTodas();
      setResultadoReintento(
        r.intentadas === 0
          ? "No había nada que reintentar."
          : r.siguenSinSalir === 0
            ? `Listo: salieron las ${r.salieron} facturas.`
            : `Salieron ${r.salieron}. Siguen sin salir ${r.siguenSinSalir}: avisa al administrador.`
      );
    } catch (e) {
      setResultadoReintento(mensajeDeError(e, "No se pudo reintentar."));
    } finally {
      setReintentando(false);
      await cargar();
    }
  }

  const modo = estado?.modo ?? "apagado";
  const hayProblemas = modo === "real" && sinEmitir.length > 0;
  const semaforo = hayProblemas
    ? { color: "bg-red-500", titulo: `Hay ${sinEmitir.length} factura${sinEmitir.length === 1 ? "" : "s"} que no salieron`, texto: "Mira la lista de abajo y toca Reintentar." }
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
            {sinEmitir.some((x) => x.reintentable) && (
              <Button onClick={reintentarTodas} disabled={reintentando}>
                {reintentando ? "Reintentando..." : "Reintentar todas"}
              </Button>
            )}
          </div>
          {resultadoReintento && <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{resultadoReintento}</p>}
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
                  <p className={x.reintentable ? "text-amber-700" : "text-red-700"}>{TEXTO_ESTADO[x.estado] ?? "Avisa al administrador."}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
