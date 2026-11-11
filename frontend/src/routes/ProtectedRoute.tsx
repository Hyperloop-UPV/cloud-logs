// Puerta de las rutas que necesitan sesion.
//
// Mientras se intenta recuperar la sesion con la cookie de refresh no se decide
// nada: mandar al login en ese hueco expulsaria a alguien que si tiene sesion.

import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth/useAuth";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Restoring session…
      </div>
    );
  }

  if (status === "anonymous") {
    return (
      <Navigate
        to="/signin"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <>{children}</>;
}
