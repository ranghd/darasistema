import { useEffect, useState } from "react";
import { api } from "../lib/api";

type EstadoUpdater =
  | { estado: "buscando" }
  | { estado: "disponible"; version: string }
  | { estado: "no-disponible" }
  | { estado: "descargando"; porcentaje: number }
  | { estado: "descargado"; version: string }
  | { estado: "error"; mensaje: string };

export default function UpdateBanner() {
  const [estado, setEstado] = useState<EstadoUpdater | null>(null);

  useEffect(() => {
    if (!api.updater?.onEstado) return;
    const quitar = api.updater.onEstado((data: EstadoUpdater) => {
      setEstado(data);
      if (data.estado === "no-disponible") {
        setTimeout(() => setEstado((actual) => (actual?.estado === "no-disponible" ? null : actual)), 4000);
      }
    });
    return quitar;
  }, []);

  if (!estado || estado.estado === "buscando") return null;

  const estilos: Record<string, string> = {
    "no-disponible": "bg-slate-700",
    disponible: "bg-brand-600",
    descargando: "bg-brand-600",
    descargado: "bg-emerald-600",
    error: "bg-amber-600",
  };

  const mensajes: Record<string, string> = {
    "no-disponible": "Ya tienes la ultima version instalada.",
    disponible: `Hay una actualizacion disponible (v${"version" in estado ? estado.version : ""}). Descargando...`,
    descargando: `Descargando actualizacion... ${"porcentaje" in estado ? estado.porcentaje : 0}%`,
    descargado: `Actualizacion lista (v${"version" in estado ? estado.version : ""}). Reiniciando...`,
    error: `No se pudo actualizar: ${"mensaje" in estado ? estado.mensaje : ""}`,
  };

  return (
    <div className={`fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium text-white print:hidden ${estilos[estado.estado]}`}>
      {mensajes[estado.estado]}
    </div>
  );
}
