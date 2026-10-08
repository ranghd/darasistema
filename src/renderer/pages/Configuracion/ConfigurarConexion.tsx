import { useState } from "react";
import { api } from "../../lib/api";
import { Button, Card, Input } from "../../components/ui";
import Logo from "../../components/Logo";

export default function ConfigurarConexion() {
  const [servidorUrl, setServidorUrl] = useState("");
  const [puerto, setPuerto] = useState(4500);
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; error?: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function probar() {
    setProbando(true);
    setResultado(null);
    try {
      const r = await api.red.probarConexion(servidorUrl);
      setResultado(r as any);
    } finally {
      setProbando(false);
    }
  }

  async function guardar() {
    setGuardando(true);
    try {
      await api.red.guardarConfig({ modo: "CAJA_REMOTA", puerto, servidorUrl });
      await api.app.reiniciar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-100">
      <Card className="w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-2">
          <Logo size={36} />
          <div>
            <p className="text-sm font-semibold text-slate-900">Cajapunto1</p>
            <p className="text-xs text-slate-400">Primer arranque</p>
          </div>
        </div>
        <h1 className="mb-1 text-lg font-semibold text-slate-900">Conecta esta caja al servidor</h1>
        <p className="mb-4 text-sm text-slate-500">
          Esta computadora no guarda los datos: necesita la direccion de la computadora principal (Servidor) para poder facturar. La
          encuentras en esa computadora, en Configuracion → Red / Conexion en Caja.
        </p>
        <div className="space-y-3">
          <Input label="Direccion del servidor" placeholder="http://192.168.1.45:4500" value={servidorUrl} onChange={(e) => setServidorUrl(e.target.value)} />
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={probar} disabled={probando || !servidorUrl}>
              {probando ? "Probando..." : "Probar conexion"}
            </Button>
            {resultado && (
              <span className={`text-sm ${resultado.ok ? "text-emerald-600" : "text-red-600"}`}>
                {resultado.ok ? "Conexion exitosa" : resultado.error ?? "No se pudo conectar"}
              </span>
            )}
          </div>
          <Button onClick={guardar} disabled={guardando || !servidorUrl} className="w-full">
            {guardando ? "Guardando..." : "Guardar y continuar"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
