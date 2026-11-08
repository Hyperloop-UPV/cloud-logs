// Pantalla de acceso.
//
// Unica pantalla sin el rail lateral: antes de entrar no hay nada que navegar. La
// jerarquia va de lo general a lo concreto: primero de quien es la herramienta
// (Hyperloop UPV), luego que herramienta es (Cloud Logs), y por ultimo la accion.
//
// El icono de Hyperloop UPV Software queda de marca de agua al fondo, como en el
// selector de modo del Electron: presente, pero sin disputarle atencion al boton.

import { Button, Input } from "@hyperloopupv/frontend-kit/components";
import { useState } from "react";
import { ApiError } from "../api/client";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { GithubMark } from "../components/brand/GithubMark";
import { SoftwareMark } from "../components/brand/SoftwareMark";
import { TeamLogo } from "../components/brand/TeamLogo";

export function SignIn() {
  const { signIn, signInWithMasterKey, status } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");

  // Con sesion viva esta pantalla no puede quedarse delante. ProtectedRoute manda
  // aqui a quien no la tiene, pero al arrancar el refresh puede recuperarla: sin
  // esta salida, el login tapa la aplicacion de alguien que ya ha entrado, y lo
  // mismo pasa al volver de GitHub.
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (status === "authenticated") return <Navigate to={from} replace />;

  if (status === "loading") {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Restoring session…
      </div>
    );
  }

  const enterWithKey = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithMasterKey(key);
      // No hace falta navegar: con la sesion lista, el guardia de arriba redirige.
    } catch (err) {
      // El backend responde "Invalid access token", que habla de tokens y no de
      // la clave que la persona acaba de escribir. Un 401 aqui solo puede
      // significar una cosa, asi que se dice esa.
      const rejected =
        err instanceof ApiError
          ? err.status === 401 || err.status === 403
          : false;
      setError(
        rejected
          ? "That master key was not accepted."
          : err instanceof Error
            ? err.message
            : "The key could not be checked. Is the API running?",
      );
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof Error
          ? err.message
          : "GitHub sign-in is unavailable. Check that the API is running.",
      );
    }
  };

  return (
    <main className="relative flex h-full w-full items-center justify-center overflow-hidden px-6">
      <SoftwareMark
        className="pointer-events-none absolute bottom-[-6rem] left-1/2 w-[30rem] -translate-x-1/2 opacity-[0.04]"
        alt=""
      />

      <div className="relative w-full max-w-[24rem]">
        <div className="flex items-center gap-2.5">
          <TeamLogo size={32} />
          <span className="text-sm font-semibold tracking-wider uppercase">
            Hyperloop UPV
          </span>
        </div>

        <h1 className="mt-5 text-3xl font-bold tracking-tight">Cloud Logs</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Telemetry archive for the pod. Sign in with the GitHub account that
          belongs to the organisation.
        </p>

        <Button
          className="mt-7 w-full gap-2"
          onClick={() => void start()}
          disabled={busy}
        >
          <GithubMark className="size-4 shrink-0" />
          {busy ? "Opening GitHub…" : "Sign in with GitHub"}
        </Button>

        {/* El acceso por clave maestra es la puerta de servicio: entra sin pasar
            por GitHub, sirve para operacion y desarrollo, y no debe competir con
            el camino normal. Por eso va plegada. */}
        {keyOpen ? (
          <form
            className="mt-4 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void enterWithKey();
            }}
          >
            <label
              htmlFor="master-key"
              className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase"
            >
              Master key
            </label>
            <Input
              id="master-key"
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="MASTER_API_KEY"
              className="font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                variant="outline"
                className="flex-1"
                disabled={busy || !key.trim()}
              >
                {busy ? "Checking…" : "Continue"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setKeyOpen(false);
                  setKey("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
            <p className="text-muted-foreground text-[11px]">
              Full administrator access, with no user account behind it. It is
              kept for this tab only and is forgotten when you close it.
            </p>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setKeyOpen(true);
              setError(null);
            }}
            className="text-muted-foreground hover:text-foreground mt-4 text-[11px] underline underline-offset-2"
          >
            Use a master key instead
          </button>
        )}

        {error && <p className="text-destructive mt-3 text-xs">{error}</p>}

        <p className="text-muted-foreground/70 mt-10 flex items-center gap-2 text-[11px]">
          <SoftwareMark className="size-4 shrink-0 opacity-60" alt="" />
          Built by Hyperloop UPV Software H12
        </p>
      </div>
    </main>
  );
}
