// Aviso de que se recupero un trabajo a medias (venta, factura o compra).
export default function AvisoBorrador({ texto, onDescartar, onOcultar }: { texto: string; onDescartar: () => void; onOcultar: () => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-800">
      <span className="h-2 w-2 rounded-full bg-brand-500" />
      <span>{texto}</span>
      <div className="ml-auto flex gap-3 text-xs font-medium">
        <button type="button" tabIndex={-1} className="text-brand-700 hover:underline" onClick={onOcultar}>
          Seguir
        </button>
        <button type="button" tabIndex={-1} className="text-red-600 hover:underline" onClick={onDescartar}>
          Descartar y empezar de nuevo
        </button>
      </div>
    </div>
  );
}
