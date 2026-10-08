import { DurableObject } from "cloudflare:workers";
import { conRegistro, type Handler } from "./electron-shim";
import { DurableObjectDB } from "./do-db";
import { puedeInvocar, type Rol } from "./permisos";
import { SCHEMA_SQL } from "../../electron/db/schema";
import { migrar } from "../../electron/db/migraciones";
import { seedCatalogo, seedDemo, type DatosEmpresa } from "../../electron/db/seed";
import { nuevoPasswordHash } from "../../electron/db/password";
import { registerCuentasIpc } from "../../electron/ipc/cuentas";
import { registerAsientosIpc } from "../../electron/ipc/asientos";
import { registerClientesIpc } from "../../electron/ipc/clientes";
import { registerProductosIpc } from "../../electron/ipc/productos";
import { registerFacturasIpc } from "../../electron/ipc/facturas";
import { registerCobrosIpc } from "../../electron/ipc/cobros";
import { registerEnvasesIpc } from "../../electron/ipc/envases";
import { registerReportesIpc } from "../../electron/ipc/reportes";
import { registerConfigIpc } from "../../electron/ipc/config";
import { registerComprobantesIpc } from "../../electron/ipc/comprobantes";
import { registerAuthIpc } from "../../electron/ipc/auth";
import { registerComprasIpc } from "../../electron/ipc/compras";
import { registerProveedoresIpc } from "../../electron/ipc/proveedores";

export interface InicializarEmpresa {
  empresa: DatosEmpresa;
  admin: { usuario: string; nombre: string; password: string };
  demo: boolean;
}

export interface SesionEmpresa {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
}

const MAX_FALLOS = 5;
const CANALES_CON_AUTOR = new Set(["facturas:crear"]);
const BLOQUEO_MS = 10 * 60 * 1000;

// Una instancia por empresa cliente: su propia base SQLite, aislada del resto.
export class Empresa extends DurableObject {
  private db: DurableObjectDB;
  private handlers: Record<string, Handler> = {};

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as any);
    this.db = new DurableObjectDB(ctx.storage);
    this.prepararEsquema();

    const db = this.db;
    conRegistro(this.handlers, () => {
      registerCuentasIpc(db);
      registerAsientosIpc(db);
      registerClientesIpc(db);
      registerProductosIpc(db);
      registerFacturasIpc(db);
      registerCobrosIpc(db);
      registerEnvasesIpc(db);
      registerReportesIpc(db);
      registerConfigIpc(db);
      registerComprobantesIpc(db);
      registerAuthIpc(db);
      registerComprasIpc(db);
      registerProveedoresIpc(db);
    });
  }

  private prepararEsquema() {
    this.db.exec(SCHEMA_SQL);
    this.db.exec(`CREATE TABLE IF NOT EXISTS _meta (clave TEXT PRIMARY KEY, valor TEXT)`);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS _login_intentos (
         usuario TEXT PRIMARY KEY,
         fallos INTEGER NOT NULL DEFAULT 0,
         bloqueado_hasta INTEGER NOT NULL DEFAULT 0
       )`
    );
    migrar(this.db);
  }

  private inicializada(): boolean {
    return !!this.db.prepare(`SELECT valor FROM _meta WHERE clave = 'inicializada'`).get();
  }

  inicializar(datos: InicializarEmpresa): void {
    if (this.inicializada()) throw new Error("Esta empresa ya fue creada");
    const usuario = datos.admin.usuario.trim().toLowerCase();
    if (!usuario) throw new Error("El usuario administrador es obligatorio");
    if (!datos.admin.password || datos.admin.password.length < 6) {
      throw new Error("La contrasena del administrador debe tener al menos 6 caracteres");
    }

    this.db.transaction(() => {
      seedCatalogo(this.db, datos.empresa);
      if (datos.demo) seedDemo(this.db);
      this.db
        .prepare(`INSERT INTO usuarios (usuario, nombre, password_hash, rol, activo) VALUES (@usuario, @nombre, @password_hash, 'ADMIN', 1)`)
        .run({ usuario, nombre: datos.admin.nombre || usuario, password_hash: nuevoPasswordHash(datos.admin.password) });
      this.db.prepare(`INSERT INTO _meta (clave, valor) VALUES ('inicializada', @fecha)`).run({ fecha: new Date().toISOString() });
    })();
  }

  login(usuario: string, password: string): SesionEmpresa {
    const nombre = (usuario ?? "").trim().toLowerCase();
    const ahora = Date.now();
    const intento = this.db.prepare(`SELECT fallos, bloqueado_hasta FROM _login_intentos WHERE usuario = ?`).get(nombre) as
      | { fallos: number; bloqueado_hasta: number }
      | undefined;

    if (intento && intento.bloqueado_hasta > ahora) {
      const minutos = Math.ceil((intento.bloqueado_hasta - ahora) / 60000);
      throw new Error(`Demasiados intentos fallidos. Intenta de nuevo en ${minutos} minuto(s).`);
    }

    try {
      const sesion = this.handlers["auth:login"]({}, nombre, password) as SesionEmpresa;
      this.db.prepare(`DELETE FROM _login_intentos WHERE usuario = ?`).run(nombre);
      return sesion;
    } catch (err) {
      const fallos = (intento?.fallos ?? 0) + 1;
      const bloqueo = fallos >= MAX_FALLOS ? ahora + BLOQUEO_MS : 0;
      this.db
        .prepare(
          `INSERT INTO _login_intentos (usuario, fallos, bloqueado_hasta) VALUES (@usuario, @fallos, @bloqueo)
           ON CONFLICT(usuario) DO UPDATE SET fallos = @fallos, bloqueado_hasta = @bloqueo`
        )
        .run({ usuario: nombre, fallos: bloqueo ? 0 : fallos, bloqueo });
      throw err;
    }
  }

  async invoke(canal: string, args: unknown[], rol: Rol, uid?: number): Promise<unknown> {
    if (!puedeInvocar(rol, canal)) throw new Error("No tienes permiso para esta operacion");
    const handler = this.handlers[canal];
    if (!handler) throw new Error(`Operacion desconocida: ${canal}`);
    const lista = [...(args ?? [])];
    // Quien hizo la operacion sale de la sesion, no de lo que mande la pantalla.
    if (CANALES_CON_AUTOR.has(canal) && lista[0] && typeof lista[0] === "object") {
      const u = uid ? (this.db.prepare(`SELECT nombre FROM usuarios WHERE id = ?`).get(uid) as { nombre: string } | undefined) : undefined;
      lista[0] = { ...(lista[0] as object), creado_por: u?.nombre ?? null };
    }
    return await handler({}, ...lista);
  }

  exportar(): Record<string, unknown[]> {
    const tablas = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`)
      .all() as { name: string }[];
    const resultado: Record<string, unknown[]> = {};
    for (const { name } of tablas) {
      resultado[name] = this.db.prepare(`SELECT * FROM "${name}"`).all();
    }
    return resultado;
  }

  // Borra todos los datos de la empresa (cuando un cliente deja el sistema).
  // Cloudflare guarda 30 dias de historial, asi que se puede recuperar si fue un error.
  async borrar(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.prepararEsquema();
  }
}
