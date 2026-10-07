import type { DB, Statement } from "../../electron/db/types";

type Valor = string | number | null | ArrayBuffer;

function normalizar(v: unknown): Valor {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v as Valor;
}

// La API SQL de Durable Objects solo acepta "?" como marcador. Los handlers
// usan "@nombre" con un objeto de valores (estilo better-sqlite3), asi que se
// traducen aqui respetando el orden de aparicion (un nombre repetido se repite).
function compilar(sql: string, args: unknown[]): { query: string; valores: Valor[] } {
  if (args.length === 1 && args[0] !== null && typeof args[0] === "object" && !Array.isArray(args[0])) {
    const obj = args[0] as Record<string, unknown>;
    const valores: Valor[] = [];
    const query = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_m, nombre: string) => {
      valores.push(normalizar(obj[nombre]));
      return "?";
    });
    return { query, valores };
  }
  return { query: sql, valores: args.map(normalizar) };
}

export class DurableObjectDB implements DB {
  private profundidad = 0;

  constructor(private storage: DurableObjectStorage) {}

  prepare(sql: string): Statement {
    const storage = this.storage;
    return {
      get<T = any>(...args: unknown[]): T | undefined {
        const { query, valores } = compilar(sql, args);
        return storage.sql.exec(query, ...valores).toArray()[0] as T | undefined;
      },
      all<T = any>(...args: unknown[]): T[] {
        const { query, valores } = compilar(sql, args);
        return storage.sql.exec(query, ...valores).toArray() as T[];
      },
      run(...args: unknown[]) {
        const { query, valores } = compilar(sql, args);
        const cursor = storage.sql.exec(query, ...valores);
        cursor.toArray();
        const fila = storage.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number };
        return { lastInsertRowid: Number(fila.id), changes: cursor.rowsWritten };
      },
    };
  }

  exec(sql: string): void {
    this.storage.sql.exec(sql).toArray();
  }

  pragma(_statement: string): void {}

  // Cloudflare no permite BEGIN/SAVEPOINT ni anidar transactionSync: solo el
  // nivel mas externo abre la transaccion. Si algo falla adentro, la excepcion
  // sube y se revierte todo, igual que con la base local.
  transaction<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
    return (...args: Args) => {
      if (this.profundidad > 0) return fn(...args);
      this.profundidad++;
      try {
        return this.storage.transactionSync(() => fn(...args));
      } finally {
        this.profundidad--;
      }
    };
  }

  // Durable Objects guarda cada escritura automaticamente.
  persist(): void {}
}
