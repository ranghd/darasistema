import { esVariantCaja } from "../lib/variant";

// Logo de la app (monograma). Los mismos dibujos estan en build/logos/*.svg para los iconos del instalador.
export default function Logo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={`shrink-0 ${className}`} role="img" aria-label={esVariantCaja ? "Cajapunto1" : "Darasistema"}>
      <rect width="100" height="100" rx="22" fill="#042C53" />
      {esVariantCaja ? (
        <>
          <path d="M68 32 A24 24 0 1 0 68 68" fill="none" stroke="#ffffff" strokeWidth="13" strokeLinecap="round" />
          <circle cx="71" cy="50" r="7" fill="#EF9F27" />
        </>
      ) : (
        <>
          <path d="M28 22 H48 A28 28 0 0 1 48 78 H28 Z" fill="#ffffff" />
          <path d="M48 31 C52 39 58 44 58 53 A10 10 0 0 1 38 53 C38 46 44 41 48 31 Z" fill="#042C53" />
        </>
      )}
    </svg>
  );
}
