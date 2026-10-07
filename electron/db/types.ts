// Contrato de acceso a datos que usan todos los handlers de negocio
// (electron/ipc/*.ts). Lo implementan la base local con sql.js
// (electron/db/sqlite.ts) y la base en la nube sobre Durable Objects
// (cloud/src/do-db.ts). No debe importar nada en tiempo de ejecucion.

export interface Statement {
  get<T = any>(...args: unknown[]): T | undefined;
  all<T = any>(...args: unknown[]): T[];
  run(...args: unknown[]): { lastInsertRowid: number; changes: number };
}

export interface DB {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(statement: string): void;
  transaction<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R;
  persist(): void;
}
