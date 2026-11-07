import { useContext } from 'react'
import { AuthContext } from './auth-context'
import type { AuthState } from './auth-context'

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
