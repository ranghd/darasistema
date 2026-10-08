import { useEffect, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import type { ConfigImpresion, ImpresoraInfo } from "../../lib/types";
import { htmlPruebaImpresion } from "../../lib/ticket";
import { Button, Card, Select } from "../../components/ui";

// Impresora de esta computadora (cada PC tiene la suya; no se comparte por la nube).
export default function ImpresoraCard({ nombreEmpresa }: { nombreEmpresa: string }) {
  const [config, setConfig] = useState<ConfigImpresion | null>(null);
  const [impresoras, setImpresoras] = useState<ImpresoraInfo[]>([]);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    Promise.all([api.impresion.obtenerConfig(), api.impresion.listar()]).then(([c, l]) => {
      setConfig(c);
      setImpresoras(l);
    });
  }, []);

  async function cambiar(cambios: Partial<ConfigImpresion>) {
    setAviso(null);
    setConfig(await api.impresion.guardarConfig(cambios));
  }

  async function probar() {
    if (!config) return;
    setTrabajando(true);
    setAviso(null);
    try {
      await api.impresion.imprimirTicket(htmlPruebaImpresion(config.anchoMm, nombreEmpresa || "Darasistema"));
      setAviso({ ok: true, texto: "Prueba enviada. Si no salio el papel, revisa que la impresora este encendida y con papel." });
    } catch (err) {
      setAviso({ ok: false, texto: mensajeDeError(err, "No se pudo imprimir") });
    } finally {
      setTrabajando(false);
    }
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
