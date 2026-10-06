type Listener = (mensaje: string | null) => void;

let listeners: Listener[] = [];
let ultimoError: string | null = null;

export function onConnectionStatusChange(cb: Listener): () => void {
  listeners.push(cb);
  cb(ultimoError);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function reportarErrorConexion(mensaje: string) {
  ultimoError = mensaje;
  listeners.forEach((l) => l(ultimoError));
}

export function limpiarErrorConexion() {
  if (ultimoError === null) return;
  ultimoError = null;
  listeners.forEach((l) => l(ultimoError));
}
