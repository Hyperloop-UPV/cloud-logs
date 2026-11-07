import { createContext } from 'react'
import type { User } from '../api/types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthState {
  status: AuthStatus
  user: User | null
  isAdmin: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  /** Para el callback de OAuth, que ya ha dejado la sesión lista en el cliente. */
  adoptSession: (user: User | null) => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)
