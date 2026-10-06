import { useEffect, useState } from "react";
import { onConnectionStatusChange } from "../lib/connectionStatus";

export default function ConnectionBanner() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onConnectionStatusChange(setError), []);

  if (!error) return null;

  return (
    <div className="flex items-center gap-2 bg-red-600 px-4 py-2 text-sm text-white print:hidden">
      <span className="font-semibold">Sin conexion:</span>
      <span>{error}</span>
    </div>
  );
}
