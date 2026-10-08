import { ipcMain } from "electron";
import type { DB } from "../db/types";
import type { Cliente, Cobro, FacturaHistorial, FiltrosHistorial, HistorialCliente, ResumenCliente } from "../shared/types";

const MAX_POR_PAGINA = 5000;

// Construye el WHERE del historial a partir de los filtros. Todo sale de las
// facturas reales del cliente (no hay una tabla de historial aparte).
function filtroHistorial(clienteId: number, f: FiltrosHistorial) {
  const where = ["f.cliente_id = @cliente_id"];
  const params: Record<string, unknown> = { cliente_id: clienteId };
  if (f.desde) {
    where.push("f.fecha >= @desde");
    params.desde = f.desde;
  }
  if (f.hasta) {
    where.push("f.fecha <= @hasta");
    params.hasta = f.hasta;
  }
  if (f.estado) {
    where.push("f.estado = @estado");
    params.estado = f.estado;
  }
  if (f.metodo === "CREDITO") {
    where.push("f.condicion_pago = 'CREDITO'");
  } else if (f.metodo) {
    where.push("f.condicion_pago = 'CONTADO' AND COALESCE(f.metodo_pago, 'EFECTIVO') = @metodo");
    params.metodo = f.metodo;
  }
  if (f.usuario) {
    where.push("f.creado_por = @usuario");
    params.usuario = f.usuario;
  }
  if (f.producto_id) {
    where.push("EXISTS (SELECT 1 FROM factura_lineas fl WHERE fl.factura_id = f.id AND fl.producto_id = @producto_id)");
    params.producto_id = f.producto_id;
  }
  if (f.ids && f.ids.length > 0) {
    const nombres = f.ids.slice(0, MAX_POR_PAGINA).map((id, i) => {
      params[`id${i}`] = Number(id);
      return `@id${i}`;
    });
    where.push(`f.id IN (${nombres.join(", ")})`);
  }
  const texto = f.busqueda?.trim();
  if (texto) {
    where.push(`(
      f.ncf LIKE @texto OR CAST(f.numero AS TEXT) LIKE @texto OR f.nota_credito_ncf LIKE @texto OR f.nota_debito_ncf LIKE @texto
      OR f.creado_por LIKE @texto
      OR EXISTS (SELECT 1 FROM factura_lineas fl JOIN productos p ON p.id = fl.producto_id
                 WHERE fl.factura_id = f.id AND (p.nombre LIKE @texto OR p.codigo LIKE @texto))
    )`);
    params.texto = `%${texto}%`;
  }
  return { clause: where.join(" AND "), params };
}

function siguienteCodigo(db: DB): string {
  const last = db
    .prepare(`SELECT codigo FROM clientes ORDER BY id DESC LIMIT 1`)
    .get() as { codigo: string } | undefined;
  const n = last ? parseInt(last.codigo.split("-")[1] ?? "0", 10) + 1 : 1;
  return `CLI-${String(n).padStart(4, "0")}`;
}

export function registerClientesIpc(db: DB) {
  ipcMain.handle("clientes:listar", () => {
    return db.prepare(`SELECT * FROM clientes ORDER BY nombre`).all() as Cliente[];
  });

  ipcMain.handle("clientes:obtener", (_e, id: number) => {
    return db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(id) as Cliente | undefined;
  });

  ipcMain.handle("clientes:estadoCuenta", (_e, id: number) => {
    const facturas = db
      .prepare(
        `SELECT f.*, COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0) as cobrado
         FROM facturas f WHERE f.cliente_id = ? ORDER BY f.fecha DESC`
      )
      .all(id);
    const envases = db
      .prepare(
        `SELECT ec.*, p.nombre as producto_nombre FROM envases_cliente ec
         JOIN productos p ON p.id = ec.producto_id WHERE ec.cliente_id = ? AND ec.cantidad != 0`
      )
      .all(id);
    return { facturas, envases };
  });

  ipcMain.handle("clientes:historial", (_e, clienteId: number, filtros: FiltrosHistorial = {}): HistorialCliente => {
    const { clause, params } = filtroHistorial(clienteId, filtros);
    const porPagina = Math.min(Math.max(Number(filtros.porPagina) || 25, 1), MAX_POR_PAGINA);
    const pagina = Math.max(Number(filtros.pagina) || 1, 1);

    const conteo = db
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN f.estado != 'ANULADA' THEN f.total ELSE 0 END), 0) AS suma FROM facturas f WHERE ${clause}`)
      .get(params) as { n: number; suma: number };

    const facturas = db
      .prepare(
        `SELECT f.*, c.nombre AS cliente_nombre,
                COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0) AS cobrado
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id
         WHERE ${clause}
         ORDER BY f.fecha DESC, f.numero DESC
         LIMIT @limite OFFSET @desplazamiento`
      )
      .all({ ...params, limite: porPagina, desplazamiento: (pagina - 1) * porPagina }) as FacturaHistorial[];

    const lineasStmt = db.prepare(
      `SELECT fl.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo FROM factura_lineas fl
       JOIN productos p ON p.id = fl.producto_id WHERE fl.factura_id = ? ORDER BY fl.id`
    );
    const cobrosStmt = db.prepare(`SELECT * FROM cobros WHERE factura_id = ? ORDER BY fecha, id`);
    const filas = facturas.map((f) => ({ ...f, lineas: lineasStmt.all(f.id) as any[], cobros: cobrosStmt.all(f.id) as Cobro[] }));

    return { filas, total: conteo.n, sumaTotal: conteo.suma, pagina, porPagina };
  });

  ipcMain.handle("clientes:resumen", (_e, clienteId: number): ResumenCliente => {
    const r = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN estado != 'ANULADA' THEN 1 ELSE 0 END), 0) AS compras,
           COALESCE(SUM(CASE WHEN estado = 'ANULADA' THEN 1 ELSE 0 END), 0) AS anuladas,
           COALESCE(SUM(CASE WHEN estado != 'ANULADA' THEN total ELSE 0 END), 0) AS total_gastado,
           MIN(CASE WHEN estado != 'ANULADA' THEN fecha END) AS primera_compra,
           MAX(CASE WHEN estado != 'ANULADA' THEN fecha END) AS ultima_compra
         FROM facturas WHERE cliente_id = ?`
      )
      .get(clienteId) as Omit<ResumenCliente, "ticket_promedio" | "saldo_pendiente" | "facturas_pendientes" | "productos" | "usuarios">;

    const pendiente = db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(f.total - COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0)), 0) AS saldo
         FROM facturas f WHERE f.cliente_id = ? AND f.estado = 'PENDIENTE'`
      )
      .get(clienteId) as { n: number; saldo: number };

    const productos = db
      .prepare(
        `SELECT fl.producto_id, p.nombre AS producto_nombre, SUM(fl.cantidad) AS cantidad, SUM(fl.subtotal) AS monto,
                COUNT(DISTINCT f.id) AS veces, MAX(f.fecha) AS ultima_fecha
         FROM factura_lineas fl
         JOIN facturas f ON f.id = fl.factura_id
         JOIN productos p ON p.id = fl.producto_id
         WHERE f.cliente_id = ? AND f.estado != 'ANULADA'
         GROUP BY fl.producto_id
         ORDER BY monto DESC`
      )
      .all(clienteId) as ResumenCliente["productos"];

    const usuarios = (
      db.prepare(`SELECT DISTINCT creado_por FROM facturas WHERE cliente_id = ? AND creado_por IS NOT NULL ORDER BY creado_por`).all(clienteId) as {
        creado_por: string;
      }[]
    ).map((u) => u.creado_por);

    return {
      ...r,
      ticket_promedio: r.compras ? r.total_gastado / r.compras : 0,
      saldo_pendiente: pendiente.saldo,
      facturas_pendientes: pendiente.n,
      productos,
      usuarios,
    };
  });

  ipcMain.handle("clientes:crear", (_e, data: Partial<Cliente>) => {
    const codigo = data.codigo && data.codigo.length > 0 ? data.codigo : siguienteCodigo(db);
    const info = db
      .prepare(
        `INSERT INTO clientes (codigo, nombre, rnc_cedula, tipo, telefono, email, direccion, activo)
         VALUES (@codigo, @nombre, @rnc_cedula, @tipo, @telefono, @email, @direccion, 1)`
      )
      .run({
        codigo,
        nombre: data.nombre,
        rnc_cedula: data.rnc_cedula ?? null,
        tipo: data.tipo ?? "FISICA",
        telefono: data.telefono ?? null,
        email: data.email ?? null,
        direccion: data.direccion ?? null,
      });
    return db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(info.lastInsertRowid) as Cliente;
  });

  ipcMain.handle("clientes:actualizar", (_e, id: number, data: Partial<Cliente>) => {
    db.prepare(
      `UPDATE clientes SET nombre=@nombre, rnc_cedula=@rnc_cedula, tipo=@tipo, telefono=@telefono, email=@email, direccion=@direccion, activo=@activo WHERE id=@id`
    ).run({
      id,
      nombre: data.nombre,
      rnc_cedula: data.rnc_cedula ?? null,
      tipo: data.tipo ?? "FISICA",
      telefono: data.telefono ?? null,
      email: data.email ?? null,
      direccion: data.direccion ?? null,
      activo: data.activo ?? 1,
    });
    return db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(id) as Cliente;
  });
}
