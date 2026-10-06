import { ipcMain } from "electron";
import type { DB } from "../db/sqlite";
import type { CompanyConfig, NcfSecuencia } from "../shared/types";

export function registerConfigIpc(db: DB) {
  ipcMain.handle("config:obtener", () => {
    return db.prepare(`SELECT * FROM company_config WHERE id = 1`).get() as CompanyConfig;
  });

  ipcMain.handle("config:actualizar", (_e, data: Partial<CompanyConfig>) => {
    db.prepare(
      `UPDATE company_config SET nombre_empresa=@nombre_empresa, rnc=@rnc, direccion=@direccion, telefono=@telefono, itbis_rate=@itbis_rate WHERE id = 1`
    ).run({
      nombre_empresa: data.nombre_empresa,
      rnc: data.rnc ?? null,
      direccion: data.direccion ?? null,
      telefono: data.telefono ?? null,
      itbis_rate: data.itbis_rate ?? 0.18,
    });
    return db.prepare(`SELECT * FROM company_config WHERE id = 1`).get() as CompanyConfig;
  });

  ipcMain.handle("ncf:listar", () => {
    return db.prepare(`SELECT * FROM ncf_secuencias ORDER BY tipo, id DESC`).all() as NcfSecuencia[];
  });

  ipcMain.handle("ncf:crear", (_e, data: Partial<NcfSecuencia>) => {
    const info = db
      .prepare(
        `INSERT INTO ncf_secuencias (tipo, prefijo, desde, hasta, actual, vencimiento, activo) VALUES (@tipo, @prefijo, @desde, @hasta, @actual, @vencimiento, 1)`
      )
      .run({
        tipo: data.tipo,
        prefijo: data.prefijo,
        desde: data.desde ?? 1,
        hasta: data.hasta,
        actual: data.actual ?? data.desde ?? 1,
        vencimiento: data.vencimiento ?? null,
      });
    return db.prepare(`SELECT * FROM ncf_secuencias WHERE id = ?`).get(info.lastInsertRowid) as NcfSecuencia;
  });

  ipcMain.handle("ncf:actualizar", (_e, id: number, data: Partial<NcfSecuencia>) => {
    db.prepare(`UPDATE ncf_secuencias SET activo=@activo WHERE id=@id`).run({ id, activo: data.activo ?? 1 });
    return db.prepare(`SELECT * FROM ncf_secuencias WHERE id = ?`).get(id) as NcfSecuencia;
  });
}
