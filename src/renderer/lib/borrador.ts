import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";

// Borradores: lo que se esta escribiendo en una venta, factura o compra se guarda solo
// (en esta computadora, por usuario) para no perderlo al cambiar de seccion o cerrar la app.

function clave(usuario: { id?: number; usuario?: string } | null, nombre: string): string {
  return `darasistema.borrador.${usuario?.usuario ?? "anon"}.${usuario?.id ?? 0}.${nombre}`;
}

function leer<T>(k: string, inicial: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw === null ? inicial : (JSON.parse(raw) as T);
  } catch {
    return inicial;
  }
}

// Igual que useState, pero el valor sobrevive a cambiar de pantalla.
export function useBorrador<T>(nombre: string, inicial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const { usuario } = useAuth();
  const k = clave(usuario, nombre);
  const [valor, setValor] = useState<T>(() => leer(k, inicial));

  useEffect(() => {
    try {
      localStorage.setItem(k, JSON.stringify(valor));
    } catch {
      // sin espacio o sin localStorage: el borrador solo vive en memoria
    }
  }, [k, valor]);

  return [valor, setValor];
}

// Para saber si al entrar habia algo guardado (y mostrar "se recupero lo que estabas haciendo").
export function useHabiaBorrador(nombre: string, hayAlgo: (v: any) => boolean): boolean {
  const { usuario } = useAuth();
  const [habia] = useState(() => {
    const v = leer<any>(clave(usuario, nombre), null);
    return v !== null && hayAlgo(v);
  });
  return habia;
}

export function useOcultable(inicial: boolean): [boolean, () => void] {
  const [visible, setVisible] = useState(inicial);
  return [visible, useCallback(() => setVisible(false), [])];
}
