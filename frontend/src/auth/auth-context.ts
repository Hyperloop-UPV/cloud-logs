import { createContext } from "react";
import type { User } from "../api/types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  isAdmin: boolean;
  signIn: () => Promise<void>;
  /** Acceso con la master key, para operación y desarrollo sin pasar por GitHub. */
  signInWithMasterKey: (key: string) => Promise<void>;
  /** La sesión actual es de master key, no de un usuario con fila propia. */
  isMaster: boolean;
  signOut: () => Promise<void>;
  /** Para el callback de OAuth, que ya ha dejado la sesión lista en el cliente. */
  adoptSession: (user: User | null) => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);
