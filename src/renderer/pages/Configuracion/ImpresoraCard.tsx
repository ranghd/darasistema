import { useEffect, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import type { ConfigImpresion, EstadoImpresora, ImpresoraInfo } from "../../lib/types";
import { avisoDeResultado, htmlPruebaImpresion, type AvisoImpresion } from "../../lib/ticket";
import { Button, Card, Select } from "../../components/ui";

// Impresora de esta computadora (cada PC tiene la suya; no se comparte por la nube).
export default function ImpresoraCard({ nombreEmpresa }: { nombreEmpresa: string }) {
  const [config, setConfig] = useState<ConfigImpresion | null>(null);
  const [impresoras, setImpresoras] = useState<ImpresoraInfo[]>([]);
  const [estado, setEstado] = useState<EstadoImpresora | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [aviso, setAviso] = useState<AvisoImpresion | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function revisar() {
    setRevisando(true);
    try {
      setEstado(await api.impresion.estado());
    } finally {
      setRevisando(false);
    }
  }

  useEffect(() => {
    Promise.all([api.impresion.obtenerConfig(), api.impresion.listar()]).then(([c, l]) => {
      setConfig(c);
      setImpresoras(l);
    });
    revisar();
  }, []);

  async function cambiar(cambios: Partial<ConfigImpresion>) {
    setAviso(null);
    setConfig(await api.impresion.guardarConfig(cambios));
    if ("impresora" in cambios) revisar();
  }

  async function probar() {
    if (!config) return;
    setTrabajando(true);
    setAviso(null);
    try {
      setAviso(avisoDeResultado(await api.impresion.imprimirTicket(htmlPruebaImpresion(config.anchoMm, nombreEmpresa || "Darasistema"))));
    } catch (err) {
      setAviso({ ok: false, texto: `No se imprimio: ${mensajeDeError(err, "error desconocido")}` });
    } finally {
      setTrabajando(false);
      revisar();
    }
  }

  async function limpiar() {
    await api.impresion.limpiarCola();
    setAviso({ ok: true, texto: "Se cancelaron los trabajos que estaban esperando en la cola de Windows." });
    revisar();
  }

  if (!config) return null;
  const predeterminada = impresoras.find((p) => p.predeterminada);

  return (
    <Card className="mt-5 p-5">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Impresora de facturas</h2>
      <p className="mb-3 text-sm text-slate-500">
        Para impresoras de recibos (termicas de 80 o 58 mm) usa formato <b>Recibo</b>: imprime directo, sin preguntar. Esta opcion es de esta
        computadora.
      </p>

      <EstadoLinea estado={estado} revisando={revisando} onRevisar={revisar} onLimpiar={limpiar} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Impresora" value={config.impresora} onChange={(e) => cambiar({ impresora: e.target.value })}>
          <option value="">Predeterminada de Windows{predeterminada ? ` (${predeterminada.nombre})` : ""}</option>
          {impresoras.map((p) => (
            <option key={p.nombre} value={p.nombre}>
              {p.nombre}
            </option>
          ))}
        </Select>
        <Select label="Formato" value={config.formato} onChange={(e) => cambiar({ formato: e.target.value as ConfigImpresion["formato"] })}>
          <option value="TICKET">Recibo (impresora termica)</option>
          <option value="CARTA">Hoja carta (impresora normal)</option>
        </Select>
        <Select label="Ancho del papel" value={config.anchoMm} onChange={(e) => cambiar({ anchoMm: Number(e.target.value) as 58 | 80 })} disabled={config.formato !== "TICKET"}>
          <option value={80}>80 mm</option>
          <option value={58}>58 mm</option>
        </Select>
        <div className="flex items-end">
          <Button variant="secondary" onClick={probar} disabled={trabajando || config.formato !== "TICKET"}>
            {trabajando ? "Imprimiendo..." : "Imprimir prueba"}
          </Button>
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={config.imprimirAlCobrar} onChange={(e) => cambiar({ imprimirAlCobrar: e.target.checked })} disabled={config.formato !== "TICKET"} />
        Imprimir el recibo automaticamente al cobrar en Caja / POS
      </label>
      {aviso && <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${aviso.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{aviso.texto}</p>}
    </Card>
  );
}

function EstadoLinea({ estado, revisando, onRevisar, onLimpiar }: { estado: EstadoImpresora | null; revisando: boolean; onRevisar: () => void; onLimpiar: () => void }) {
  const lista = estado && !estado.mensaje;
  const color = !estado || !estado.verificado ? "bg-slate-300" : lista ? "bg-emerald-500" : "bg-red-500";
  const texto = !estado
    ? "Revisando la impresora..."
    : !estado.verificado
      ? "No se pudo revisar el estado de la impresora."
      : estado.mensaje ?? `"${estado.nombre}" conectada y lista.`;
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm ${lista ? "border-emerald-200 bg-emerald-50/50" : estado?.verificado ? "border-red-200 bg-red-50/50" : "border-slate-200"}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="text-slate-700">{texto}</span>
      {!!estado?.trabajosPendientes && (
        <span className="text-amber-700">
          {estado.trabajosPendientes} trabajo(s) esperando en la cola de Windows
          <button type="button" className="ml-2 font-medium underline" onClick={onLimpiar}>
            Cancelarlos
          </button>
        </span>
      )}
      <button type="button" className="ml-auto text-xs font-medium text-brand-600 hover:underline" onClick={onRevisar} disabled={revisando}>
        {revisando ? "Revisando..." : "Volver a revisar"}
      </button>
    </div>
  );
}
