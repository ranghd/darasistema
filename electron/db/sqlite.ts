// Adaptador que expone sobre sql.js (SQLite compilado a WebAssembly, sin
// compilacion nativa) una API sincronica compatible con la de better-sqlite3
// (prepare().get()/.all()/.run(), exec(), pragma(), transaction()), para que
// el resto del codigo de acceso a datos no necesite conocer la diferencia.
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";

type Params = Record<string, unknown> | unknown[];

function toBindParams(args: unknown[]): Record<string, unknown> | unknown[] | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 1 && args[0] !== null && typeof args[0] === "object" && !Array.isArray(args[0])) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args[0] as Record<string, unknown>)) {
      obj[`@${k}`] = v === undefined ? null : v;
    }
    return obj;
  }
  return args.map((a) => (a === undefined ? null : a));
}

class RunStatement {
  constructor(private sqljsDb: SqlJsDatabase, private sql: string, private onMutated: () => void) {}

  get<T = any>(...args: unknown[]): T | undefined {
    const stmt = this.sqljsDb.prepare(this.sql);
    try {
      const bound = toBindParams(args);
      if (bound !== undefined) stmt.bind(bound as any);
      const hasRow = stmt.step();
      return hasRow ? (stmt.getAsObject() as T) : undefined;
    } finally {
      stmt.free();
    }
  }

  all<T = any>(...args: unknown[]): T[] {
    const stmt = this.sqljsDb.prepare(this.sql);
    const rows: T[] = [];
    try {
      const bound = toBindParams(args);
      if (bound !== undefined) stmt.bind(bound as any);
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(...args: unknown[]): { lastInsertRowid: number; changes: number } {
    const stmt = this.sqljsDb.prepare(this.sql);
    try {
      const bound = toBindParams(args);
      if (bound !== undefined) stmt.bind(bound as any);
      stmt.step();
    } finally {
      stmt.free();
    }
    const idRow = this.sqljsDb.exec("SELECT last_insert_rowid() as id");
    const lastInsertRowid = idRow.length > 0 ? Number(idRow[0].values[0][0]) : 0;
    const changes = this.sqljsDb.getRowsModified();
    this.onMutated();
    return { lastInsertRowid, changes };
  }
}

export class DB {
  private sqljsDb: SqlJsDatabase;
  private dbPath: string;
  private txDepth = 0;
  private dirty = false;

  constructor(sqljsDb: SqlJsDatabase, dbPath: string) {
    this.sqljsDb = sqljsDb;
    this.dbPath = dbPath;
  }

  prepare(sql: string): RunStatement {
    return new RunStatement(this.sqljsDb, sql, () => {
      this.dirty = true;
      if (this.txDepth === 0) this.persist();
    });
  }

  exec(sql: string): void {
    this.sqljsDb.exec(sql);
  }

  pragma(_statement: string): void {
    // sql.js no requiere journal_mode/foreign_keys pragmas de la misma forma;
    // las claves foraneas se activan explicitamente al abrir la conexion.
  }

  transaction<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
    return (...args: Args) => {
      this.txDepth++;
      const savepoint = `sp_${this.txDepth}`;
      this.sqljsDb.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = fn(...args);
        this.sqljsDb.exec(`RELEASE ${savepoint}`);
        this.txDepth--;
        if (this.txDepth === 0 && this.dirty) this.persist();
        return result;
      } catch (err) {
        this.sqljsDb.exec(`ROLLBACK TO ${savepoint}`);
        this.sqljsDb.exec(`RELEASE ${savepoint}`);
        this.txDepth--;
        throw err;
      }
    };
  }

  persist(): void {
    const data = this.sqljsDb.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
    this.dirty = false;
  }
}

export async function createDatabase(dbPath: string): Promise<DB> {
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  const existing = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
  const sqljsDb = existing ? new SQL.Database(existing) : new SQL.Database();
  sqljsDb.exec("PRAGMA foreign_keys = ON;");

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new DB(sqljsDb, dbPath);
  if (!existing) db.persist();
  return db;
}
