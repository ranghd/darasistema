import { useState } from "react";
import { useAuth } from "../../lib/auth";
import { esVariantCaja } from "../../lib/variant";
import { Button, Input } from "../../components/ui";
import Logo from "../../components/Logo";

const CLAVE_EMPRESA = "darasistema.codigoEmpresa";

function empresaRecordada(): string {
  try {
    return localStorage.getItem(CLAVE_EMPRESA) ?? "";
  } catch {
    return "";
  }
}

export default function Login({ modoNube = false }: { modoNube?: boolean }) {
  const { login, aviso } = useAuth();
  const [empresa, setEmpresa] = useState(empresaRecordada);
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario.trim() || !password || (modoNube && !empresa.trim())) return;
    setError("");
    setCargando(true);
    try {
      if (modoNube) {
        await login(usuario.trim(), password, empresa.trim().toLowerCase());
        try {
          localStorage.setItem(CLAVE_EMPRESA, empresa.trim().toLowerCase());
        } catch {
          // sin localStorage solo no se recuerda el codigo
        }
      } else {
        await login(usuario.trim(), password);
      }
    } catch (err: any) {
      setError(err?.message ?? "No se pudo iniciar sesion");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={44} />
          <div>
            <p className="text-lg font-semibold text-slate-900">{esVariantCaja ? "Cajapunto1" : "Darasistema"}</p>
            <p className="text-xs text-slate-400">Gas · Oxigeno · Agua</p>
          </div>
        </div>

        <h1 className="mb-5 text-sm text-slate-500">Inicia sesion para continuar</h1>

        {aviso && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{aviso}</p>}

        <form onSubmit={onSubmit} className="space-y-3">
          {modoNube && (
            <Input
              label="Codigo de empresa"
              autoFocus={!empresa}
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              placeholder="ej. gas-del-norte"
            />
          )}
          <Input
            label="Usuario"
            autoFocus={!modoNube || !!empresa}
            autoComplete="username"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            placeholder="ej. admin"
          />
          <Input
            label="Contrasena"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="********"
          />

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={cargando || !usuario.trim() || !password || (modoNube && !empresa.trim())}>
            {cargando ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        {modoNube && <p className="mt-4 text-center text-[11px] text-slate-400">Conectado a la nube · tus datos estan disponibles desde cualquier computadora</p>}
      </div>
    </div>
  );
}
