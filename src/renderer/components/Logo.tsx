import { APP_VARIANT, EDICION, esColmado, soloVentas } from "../lib/variant";

// Logo de la app (monograma). Los mismos dibujos estan en build/logos/*.svg para los iconos del instalador.
export default function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={`shrink-0 ${className}`} role="img" aria-label={EDICION.nombre}>
      <rect width="100" height="100" rx="22" fill={esColmado ? "#0E5E3B" : soloVentas ? "#1f3a5f" : "#042C53"} />
      {soloVentas && (
        <>
          {/* la D de DARA con su aro dorado */}
          <circle cx="50" cy="50" r="36" fill="none" stroke="#c9a24b" strokeWidth="3" />
          <path d="M37 30 V70 H47 A20 20 0 0 0 47 30 Z M43 36 H47 A14 14 0 0 1 47 64 H43 Z" fill="#f4ecd8" fillRule="evenodd" />
        </>
      )}
      {(APP_VARIANT === "caja" || APP_VARIANT === "cajacolmado") && (
        <>
          <path d="M68 32 A24 24 0 1 0 68 68" fill="none" stroke="#ffffff" strokeWidth="13" strokeLinecap="round" />
          <circle cx="71" cy="50" r="7" fill="#EF9F27" />
        </>
      )}
      {APP_VARIANT === "colmado" && (
        <>
          {/* canasta de colmado */}
          <path d="M37 45 L46 26 M63 45 L54 26" fill="none" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" />
          <path d="M20 44 H80 L72 78 H28 Z" fill="#ffffff" strokeLinejoin="round" />
          <path d="M39 53 V69 M50 53 V69 M61 53 V69" stroke="#0E5E3B" strokeWidth="5" strokeLinecap="round" />
          <circle cx="78" cy="24" r="7" fill="#EF9F27" />
        </>
      )}
      {APP_VARIANT === "full" && (
        <>
          <path d="M28 22 H48 A28 28 0 0 1 48 78 H28 Z" fill="#ffffff" />
          <path d="M48 31 C52 39 58 44 58 53 A10 10 0 0 1 38 53 C38 46 44 41 48 31 Z" fill="#042C53" />
        </>
      )}
    </svg>
  );
}
