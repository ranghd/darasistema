import React, { createContext, useCallback, useContext, useState } from "react";
import { api } from "./api";
import type { SesionUsuario } from "./types";

interface AuthContextValue {
  usuario: SesionUsuario | null;
  login: (usuario: string, password: string) => Promise<void>;
  logout: () => void;
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

  const login = useCallback(async (nombreUsuario: string, password: string) => {
    const sesion = await api.auth.login(nombreUsuario, password);
    setUsuario(sesion);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sesion));
    } catch {
      // si no hay sessionStorage disponible, la sesion vive solo en memoria
    }
  }, []);

  const logout = useCallback(() => {
    setUsuario(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignorar
    }
  }, []);

  return <AuthContext.Provider value={{ usuario, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de un AuthProvider");
  return ctx;
}
