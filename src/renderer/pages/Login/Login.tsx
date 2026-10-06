import { useState } from "react";
import { useAuth } from "../../lib/auth";
import { esVariantCaja } from "../../lib/variant";
import { Button, Input } from "../../components/ui";

export default function Login() {
  const { login } = useAuth();
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario.trim() || !password) return;
    setError("");
    setCargando(true);
    try {
      await login(usuario.trim(), password);
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
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-500 text-base font-bold text-white">DS</div>
          <div>
            <p className="text-lg font-semibold text-slate-900">{esVariantCaja ? "Cajapunto1" : "Darasistema"}</p>
            <p className="text-xs text-slate-400">Gas · Oxigeno · Agua</p>
          </div>
        </div>

        <h1 className="mb-5 text-sm text-slate-500">Inicia sesion para continuar</h1>

        <form onSubmit={onSubmit} className="space-y-3">
          <Input
            label="Usuario"
            autoFocus
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

          <Button type="submit" className="w-full" disabled={cargando || !usuario.trim() || !password}>
            {cargando ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
