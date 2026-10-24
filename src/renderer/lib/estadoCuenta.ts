// Lee el estado de cuenta que se baja del banco: un CSV, o las filas copiadas
// desde Excel y pegadas (vienen separadas por tabulador). Cada banco lo arma
// distinto, asi que se adivinan las columnas y el usuario las puede corregir.
import type { MovimientoBancoInput } from "./types";

export interface Mapeo {
  fecha: number;
  descripcion: number;
  referencia: number;
  monto: number;
  debito: number;
  credito: number;
}

export interface EstadoLeido {
  encabezados: string[];
  filas: string[][];
  mapeo: Mapeo;
}

function separar(linea: string, sep: string): string[] {
  const celdas: string[] = [];
  let actual = "";
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') {
      if (comillas && linea[i + 1] === '"') (actual += '"'), i++;
      else comillas = !comillas;
    } else if (ch === sep && !comillas) {
      celdas.push(actual.trim());
      actual = "";
    } else actual += ch;
  }
  celdas.push(actual.trim());
  return celdas;
}

const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function leerEstado(texto: string): EstadoLeido {
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length === 0) return { encabezados: [], filas: [], mapeo: { fecha: -1, descripcion: -1, referencia: -1, monto: -1, debito: -1, credito: -1 } };
  const muestra = lineas.slice(0, 5).join("\n");
  const sep = muestra.includes("\t") ? "\t" : (muestra.match(/;/g)?.length ?? 0) > (muestra.match(/,/g)?.length ?? 0) ? ";" : ",";
  const todas = lineas.map((l) => separar(l, sep));
  // La fila de titulos es la primera que menciona la fecha.
  let inicio = todas.findIndex((f) => f.some((c) => /^(fecha|date|f\. ?(trans|valor|efectiva))/i.test(sinAcentos(c))));
  const encabezados = inicio >= 0 ? todas[inicio] : todas[0].map((_, i) => `Columna ${i + 1}`);
  const filas = todas.slice(inicio >= 0 ? inicio + 1 : 0).filter((f) => f.some((c) => c));
  const buscar = (re: RegExp, evitar: number[] = []) => encabezados.findIndex((h, i) => !evitar.includes(i) && re.test(sinAcentos(h)));
  const fecha = buscar(/fecha|date/);
  const debito = buscar(/debito|retiro|cargo|salida|debit/);
  const credito = buscar(/credito|deposito|abono|entrada|credit/);
  const monto = buscar(/monto|importe|valor|amount|cantidad/, [fecha]);
  const descripcion = buscar(/desc|concepto|detalle|transac|movimiento|narra/);
  const referencia = buscar(/ref|documento|serial|numero|no\./, [descripcion]);
  const mapeo: Mapeo = { fecha, descripcion, referencia, monto: debito >= 0 && credito >= 0 ? -1 : monto, debito, credito };
  if (inicio < 0) {
    // Sin titulos: se adivina por el contenido de la primera fila.
    const f0 = filas[0] ?? [];
    mapeo.fecha = f0.findIndex((c) => !!leerFecha(c));
    mapeo.monto = f0.length - 1 - [...f0].reverse().findIndex((c) => leerMonto(c) !== null);
    mapeo.descripcion = f0.findIndex((c, i) => i !== mapeo.fecha && i !== mapeo.monto && c.length > 3 && leerMonto(c) === null);
  }
  return { encabezados, filas, mapeo };
}

const MESES: Record<string, number> = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };

export function leerFecha(t: string): string | null {
  const s = sinAcentos(String(t ?? "").trim());
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{1,2})[-/ .]([a-z]{3})[a-z]*[-/ .](\d{2,4})/)) && MESES[m[2]]) [d, mo, y] = [Number(m[1]), MESES[m[2]], Number(m[3])];
  else return null;
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function leerMonto(t: string): number | null {
  let s = String(t ?? "").trim();
  if (!s) return null;
  const negativo = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s) || /\bDB\b|\bDR\b/i.test(s);
  s = s.replace(/[()\s]|RD\$|US\$|\$|DOP|DB|DR|CR/gi, "").replace(/-/g, "");
  if (!/\d/.test(s)) return null;
  // 1.234,56 (con coma decimal) o 1,234.56
  if (/,\d{1,2}$/.test(s) && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/,\d{1,2}$/.test(s) && !s.includes(".")) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

// Convierte las filas a movimientos: positivo = entro dinero, negativo = salio.
export function aMovimientos(e: EstadoLeido, mapeo: Mapeo): { movimientos: MovimientoBancoInput[]; descartadas: number } {
  const movimientos: MovimientoBancoInput[] = [];
  let descartadas = 0;
  for (const f of e.filas) {
    const fecha = mapeo.fecha >= 0 ? leerFecha(f[mapeo.fecha]) : null;
    let monto: number | null = null;
    if (mapeo.monto >= 0) monto = leerMonto(f[mapeo.monto]);
    else if (mapeo.debito >= 0 || mapeo.credito >= 0) {
      const deb = mapeo.debito >= 0 ? Math.abs(leerMonto(f[mapeo.debito]) ?? 0) : 0;
      const cre = mapeo.credito >= 0 ? Math.abs(leerMonto(f[mapeo.credito]) ?? 0) : 0;
      monto = cre - deb;
    }
    if (!fecha || monto === null || Math.abs(monto) < 0.005) {
      descartadas++;
      continue;
    }
    movimientos.push({
      fecha,
      monto: Math.round(monto * 100) / 100,
      descripcion: mapeo.descripcion >= 0 ? f[mapeo.descripcion] : "",
      referencia: mapeo.referencia >= 0 ? f[mapeo.referencia] : "",
    });
  }
  return { movimientos, descartadas };
}
