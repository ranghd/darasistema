import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Autor, Caja, SesionCaja } from "./types";

// Caja de esta computadora y su jornada abierta. Cada computadora recuerda que caja
// es (ej. "Caja principal", "Mostrador"); la jornada vive en la base de datos.

const CLAVE_CAJA = "darasistema.cajaId";

function cajaGuardada(): number | null {
  try {
    const v = Number(localStorage.getItem(CLAVE_CAJA));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

interface CajaContextValue {
  cajas: Caja[];
  cajaId: number | null;
  caja: Caja | null;
  /** Jornada abierta de la caja de esta computadora, o null si esta cerrada. */
  sesion: SesionCaja | null;
  cargando: boolean;
  seleccionarCaja: (id: number) => void;
  recargar: () => Promise<SesionCaja | null>;
  autor: () => Autor;
}

const CajaContext = createContext<CajaContextValue | null>(null);

export function CajaProvider({ children }: { children: React.ReactNode }) {
  const { usuario } = useAuth();
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [cajaId, setCajaId] = useState<number | null>(cajaGuardada);
  const [sesion, setSesion] = useState<SesionCaja | null>(null);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      const lista = (await api.cajas.listar()).filter((c) => c.activa);
      setCajas(lista);
      const id = lista.some((c) => c.id === cajaId) ? cajaId : lista[0]?.id ?? null;
      if (id !== cajaId) setCajaId(id);
      const s = id ? await api.caja.sesionActual(id) : null;
      setSesion(s);
      return s;
    } catch {
      return null;
    } finally {
      setCargando(false);
    }
  }, [cajaId]);

  useEffect(() => {
    if (usuario) recargar();
  }, [usuario, cajaId]);

  const seleccionarCaja = useCallback((id: number) => {
    setCajaId(id);
    try {
      localStorage.setItem(CLAVE_CAJA, String(id));
    } catch {
      // sin localStorage solo no se recuerda
    }
  }, []);

  const autor = useCallback((): Autor => ({ id: usuario?.id ?? null, nombre: usuario?.nombre ?? "", rol: usuario?.rol }), [usuario]);

  return (
    <CajaContext.Provider value={{ cajas, cajaId, caja: cajas.find((c) => c.id === cajaId) ?? null, sesion, cargando, seleccionarCaja, recargar, autor }}>
      {children}
    </CajaContext.Provider>
  );
}

export function useCaja(): CajaContextValue {
  const ctx = useContext(CajaContext);
  if (!ctx) throw new Error("useCaja debe usarse dentro de un CajaProvider");
  return ctx;
}

export const NOMBRE_RESULTADO = { CUADRE: "Cuadre exacto", SOBRANTE: "Sobrante", FALTANTE: "Faltante" } as const;
export const TONO_RESULTADO = { CUADRE: "green", SOBRANTE: "blue", FALTANTE: "red" } as const;
export const NOMBRE_METODO: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", CHEQUE: "Cheque", CREDITO: "Credito" };
