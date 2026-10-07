import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, EVENTO_SESION_EXPIRADA, mensajeDeError } from "./api";
import type { SesionUsuario } from "./types";

interface AuthContextValue {
  usuario: SesionUsuario | null;
  login: (usuario: string, password: string, empresa?: string) => Promise<void>;
  logout: () => void;
  /** Motivo por el que se cerro la sesion sin que el usuario lo pidiera (ej. vencio). */
  aviso: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "darasistema.sesion";

function sesionGuardada(): SesionUsuario | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SesionUsuario) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<SesionUsuario | null>(sesionGuardada);
  const [aviso, setAviso] = useState<string | null>(null);

  const login = useCallback(async (nombreUsuario: string, password: string, empresa?: string) => {
    let sesion: SesionUsuario;
    try {
      sesion = await api.auth.login(nombreUsuario, password, empresa);
    } catch (err) {
      throw new Error(mensajeDeError(err, "No se pudo iniciar sesion"));
    }
    setAviso(null);
    setUsuario(sesion);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sesion));
    } catch {
      // si no hay sessionStorage disponible, la sesion vive solo en memoria
    }
  }, []);

  const logout = useCallback(() => {
    api.auth.logout().catch(() => {});
    setUsuario(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignorar
    }
  }, []);

  // El servidor en la nube rechazo la sesion (vencio a las 12 h): volver al login.
  useEffect(() => {
    const alExpirar = () => {
      logout();
      setAviso("Tu sesion vencio. Vuelve a iniciar sesion.");
    };
    window.addEventListener(EVENTO_SESION_EXPIRADA, alExpirar);
    return () => window.removeEventListener(EVENTO_SESION_EXPIRADA, alExpirar);
  }, [logout]);

  return <AuthContext.Provider value={{ usuario, login, logout, aviso }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de un AuthProvider");
  return ctx;
}
