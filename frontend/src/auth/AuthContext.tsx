/**
 * Sesión de la aplicación.
 *
 * Hay dos formas de entrar:
 *
 * 1. **GitHub OAuth**, la normal. Al arrancar se intenta un refresh: si la cookie
 *    HttpOnly sigue viva, la sesión se recupera sin pasar por GitHub. El access
 *    token nunca sale de memoria.
 * 2. **Master key**, para operación y desarrollo. El backend la acepta en
 *    `Authorization: Bearer`, pero no hay fila de usuario detrás, asi que `/users/me`
 *    responde 401 y la identidad se sintetiza aquí replicando lo que hace
 *    `app/dependencies.py::get_current_user` para estos llamantes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  clearSession,
  refreshSession,
  setMasterSession,
  setUnauthenticatedHandler,
  storedMasterKey,
} from "../api/client";
import {
  getGithubAuthUrl,
  getMe,
  logout as logoutRequest,
  verifyMasterKey,
} from "../api/endpoints";
import type { User } from "../api/types";
import { AuthContext } from "./auth-context";
import type { AuthState, AuthStatus } from "./auth-context";

/**
 * Identidad de un llamante con master key.
 *
 * Copia la que el backend fabrica en `get_current_user`: mismo UUID de ceros y mismo
 * nombre, para que lo que enseña la interfaz coincida con lo que aparece en los logs
 * del servidor. No existe como fila en la tabla `users`.
 */
const MASTER_USER: User = {
  id: "00000000-0000-0000-0000-000000000000",
  username: "master_api_key",
  githubUsername: null,
  role: "admin",
  createdAt: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [isMaster, setIsMaster] = useState(false);

  const goAnonymous = useCallback(() => {
    clearSession();
    setUser(null);
    setIsMaster(false);
    setStatus("anonymous");
  }, []);

  // Una sesión irrecuperable (refresh rechazado) nos devuelve al login.
  useEffect(() => {
    setUnauthenticatedHandler(goAnonymous);
    return () => setUnauthenticatedHandler(null);
  }, [goAnonymous]);

  useEffect(() => {
    let active = true;
    void (async () => {
      // La master key de la pestaña se comprueba antes del refresh: si está puesta
      // es la sesión que el usuario eligió, y pedir un refresh que va a fallar
      // dispararía el manejador de "no autenticado" por el camino.
      const key = storedMasterKey();
      if (key) {
        try {
          setMasterSession(key);
          await verifyMasterKey(key);
          if (!active) return;
          setUser(MASTER_USER);
          setIsMaster(true);
          setStatus("authenticated");
          return;
        } catch {
          // Clave caducada o cambiada en el servidor: se descarta y se sigue por
          // la via normal.
          if (!active) return;
          clearSession();
        }
      }

      const token = await refreshSession();
      if (!active) return;
      if (!token) {
        setStatus("anonymous");
        return;
      }
      try {
        const me = await getMe();
        if (!active) return;
        setUser(me);
        setStatus("authenticated");
      } catch {
        if (active) goAnonymous();
      }
    })();
    return () => {
      active = false;
    };
  }, [goAnonymous]);

  const signIn = useCallback(async () => {
    window.location.href = await getGithubAuthUrl();
  }, []);

  const signInWithMasterKey = useCallback(async (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) throw new Error("Enter the master key.");
    // Se valida antes de dar la sesión por buena: si no, la aplicación entra y se
    // cae endpoint por endpoint con 401 sin explicar nada.
    await verifyMasterKey(trimmed);
    setMasterSession(trimmed);
    setUser(MASTER_USER);
    setIsMaster(true);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    try {
      // Con master key no hay refresh token que revocar en el servidor, así que
      // llamar a /logout no aporta nada y responde 401.
      if (!isMaster) await logoutRequest();
    } finally {
      goAnonymous();
    }
  }, [goAnonymous, isMaster]);

  const adoptSession = useCallback(async (next: User | null) => {
    setUser(next ?? (await getMe()));
    setIsMaster(false);
    setStatus("authenticated");
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      isAdmin: user?.role === "admin",
      isMaster,
      signIn,
      signInWithMasterKey,
      signOut,
      adoptSession,
    }),
    [
      status,
      user,
      isMaster,
      signIn,
      signInWithMasterKey,
      signOut,
      adoptSession,
    ],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
