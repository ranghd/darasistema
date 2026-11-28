import { useEffect, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import type { EcfDocumento, EstadoEcfDocumento } from "../../lib/types";
import { Badge, Button, Card } from "../../components/ui";

const TEXTO: Record<EstadoEcfDocumento, { etiqueta: string; tono: "green" | "amber" | "red" }> = {
  ACEPTADO: { etiqueta: "Aceptado por la DGII", tono: "green" },
  EN_PROCESO: { etiqueta: "La DGII lo está procesando", tono: "amber" },
  PROFORMA: { etiqueta: "Prueba (sin valor fiscal)", tono: "amber" },
  PENDIENTE: { etiqueta: "Sin emitir", tono: "red" },
  ENVIANDO: { etiqueta: "Enviándose", tono: "amber" },
  INCIERTO: { etiqueta: "No se sabe si salió", tono: "red" },
  RECHAZADO: { etiqueta: "Rechazado por la DGII", tono: "red" },
  ERROR: { etiqueta: "No salió (error)", tono: "red" },
};

// Comprobante electronico (e-CF) de una factura: su estado y lo que se puede hacer si no salio.
// No hay boton para volver a mandar (salian comprobantes repetidos): si no quedo confirmado, el administrador
// busca su numero en el portal de ef2 y lo registra.
export default function PanelEcf({ facturaId, esAdmin, anulada, onCambio }: { facturaId: number; esAdmin: boolean; anulada: boolean; onCambio: () => void }) {
  const [ecf, setEcf] = useState<EcfDocumento | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [ncfManual, setNcfManual] = useState("");
  const [nota, setNota] = useState<EcfDocumento | null>(null);
  const [confirmaNota, setConfirmaNota] = useState(false);

  async function cargar() {
    setEcf((await api.ecf.obtener(facturaId).catch(() => null)) as EcfDocumento | null);
    // la nota de credito solo importa en una factura anulada (y la ve el administrador)
    setNota(anulada && esAdmin ? ((await api.ecf.obtenerNota(facturaId).catch(() => null)) as EcfDocumento | null) : null);
  }
  useEffect(() => {
    setConfirmaNota(false);
    cargar();
  }, [facturaId, anulada]);

  async function accion(fn: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(mensajeDeError(e, "No se pudo completar"));
    } finally {
      setOcupado(false);
      await cargar();
      onCambio();
    }
  }

  if (!ecf) return null;
  const t = TEXTO[ecf.estado];
  const resuelto = ecf.estado === "ACEPTADO" || ecf.estado === "PROFORMA" || ecf.estado === "EN_PROCESO";
  return (
    <Card className="mb-5 p-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">Comprobante electrónico</span>
            <Badge tone={t.tono}>{t.etiqueta}</Badge>
            {ecf.modo === "prueba" && <Badge tone="amber">Modo prueba</Badge>}
          </div>
          {ecf.ncf && (
            <p className="text-sm text-slate-600">
              {ecf.estado === "PROFORMA" ? "Número de prueba" : "e-NCF"} <span className="font-mono">{ecf.ncf}</span>
              {ecf.track_id && <span className="ml-3 text-xs text-slate-400">TrackId {ecf.track_id}</span>}
            </p>
          )}
          {ecf.mensaje && !resuelto && <p className="text-sm text-red-700">{ecf.mensaje}</p>}
          {ecf.pdf_url && (
            <a className="text-sm text-brand-600 underline" href={ecf.pdf_url} target="_blank" rel="noreferrer">
              Ver el PDF oficial
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {ecf.estado === "EN_PROCESO" && (
            <Button variant="secondary" disabled={ocupado} onClick={() => accion(() => api.ecf.consultar(facturaId))}>
              Consultar estado
            </Button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {esAdmin && (ecf.estado === "INCIERTO" || ecf.estado === "RECHAZADO" || ecf.estado === "ERROR") && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
          <p>
            <b>Antes de hacer nada:</b> entra al portal de ef2 y busca esta factura en Facturas. Si ya aparece con número E (aunque diga Pendiente), escribe aquí ese número. Si no aparece, no la vuelvas a hacer: avisa a soporte.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm"
              placeholder="E320000000123"
              value={ncfManual}
              onChange={(e) => setNcfManual(e.target.value.toUpperCase())}
            />
            <Button variant="secondary" disabled={ocupado || !ncfManual.trim()} onClick={() => accion(() => api.ecf.registrarManual({ factura_id: facturaId, ncf: ncfManual }))}>
              Ya salió: registrar e-NCF
            </Button>
          </div>
        </div>
      )}
      {esAdmin && anulada && ecf.modo === "real" && ecf.ncf && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
          <p className="font-semibold text-slate-700">Nota de crédito ante la DGII</p>
          {nota && (nota.estado === "ACEPTADO" || nota.estado === "EN_PROCESO") ? (
            <p>
              <span className="font-mono">{nota.ncf}</span>: {nota.estado === "ACEPTADO" ? "aceptada por la DGII." : "enviada, la DGII la está procesando."}
            </p>
          ) : nota && (nota.estado === "INCIERTO" || nota.estado === "ENVIANDO" || nota.estado === "RECHAZADO") ? (
            <p className="text-red-700">
              {nota.estado === "ENVIANDO" ? "Se está enviando." : nota.mensaje} Búscala en el portal de ef2; no hagas otra.
            </p>
          ) : ecf.estado === "ACEPTADO" ? (
            <>
              <p>
                Esta factura está anulada aquí, pero <span className="font-mono">{ecf.ncf}</span> sigue válida ante la DGII. La nota de crédito la anula por el total.
              </p>
              {nota?.mensaje && <p className="text-red-700">{nota.mensaje}</p>}
              <Button
                variant="danger"
                disabled={ocupado}
                onClick={() => {
                  if (!confirmaNota) return setConfirmaNota(true);
                  setConfirmaNota(false);
                  accion(() => api.ecf.enviarNota(facturaId));
                }}
              >
                {ocupado ? "Enviando..." : confirmaNota ? "¿Seguro? Es un documento real: pulsa otra vez" : "Enviar nota de crédito"}
              </Button>
            </>
          ) : (
            <p>Cuando la DGII acepte <span className="font-mono">{ecf.ncf}</span> podrás enviar la nota de crédito.</p>
          )}
        </div>
      )}
    </Card>
  );
}
