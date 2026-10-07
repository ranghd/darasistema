// Reemplazo de "electron" dentro del Worker (ver [alias] en wrangler.toml).
// Cada Durable Object Empresa activa su propio registro mientras llama a los
// register*Ipc, para que los handlers de dos empresas en el mismo proceso no
// se mezclen. El registro se activa y desactiva de forma sincrona.

export type Handler = (evento: unknown, ...args: any[]) => any;

let registroActual: Record<string, Handler> | null = null;

export function conRegistro(destino: Record<string, Handler>, registrar: () => void) {
  registroActual = destino;
  try {
    registrar();
  } finally {
    registroActual = null;
  }
}

export const ipcMain = {
  handle(canal: string, handler: Handler) {
    if (!registroActual) throw new Error(`ipcMain.handle("${canal}") fuera de un registro activo`);
    registroActual[canal] = handler;
  },
};
