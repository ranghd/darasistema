import { DurableObject } from "cloudflare:workers";

// Lista de empresas dadas de alta. Solo se consulta al iniciar sesion y al
// crear empresas, para que nadie pueda crear bases vacias probando codigos.
export class Registro extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as any);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS empresas (
         codigo TEXT PRIMARY KEY,
         nombre TEXT NOT NULL,
         creada_en TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    );
  }

  existe(codigo: string): boolean {
    return this.ctx.storage.sql.exec(`SELECT 1 FROM empresas WHERE codigo = ?`, codigo).toArray().length > 0;
  }

  registrar(codigo: string, nombre: string): void {
    if (this.existe(codigo)) throw new Error(`Ya existe una empresa con el codigo "${codigo}"`);
    this.ctx.storage.sql.exec(`INSERT INTO empresas (codigo, nombre) VALUES (?, ?)`, codigo, nombre);
  }

  quitar(codigo: string): void {
    this.ctx.storage.sql.exec(`DELETE FROM empresas WHERE codigo = ?`, codigo);
  }

  listar(): { codigo: string; nombre: string; creada_en: string }[] {
    return this.ctx.storage.sql.exec(`SELECT codigo, nombre, creada_en FROM empresas ORDER BY creada_en`).toArray() as any;
  }
}
