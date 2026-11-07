/**
 * Sesión de la aplicación.
 *
 * Al arrancar intentamos un refresh: si la cookie HttpOnly sigue viva, recuperamos
 * la sesión sin pasar por GitHub. El access token nunca sale de memoria.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { clearSession, refreshSession, setUnauthenticatedHandler } from '../api/client'
import { getGithubAuthUrl, getMe, logout as logoutRequest } from '../api/endpoints'
import type { User } from '../api/types'
import { AuthContext } from './auth-context'
import type { AuthState, AuthStatus } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)

  const goAnonymous = useCallback(() => {
    clearSession()
    setUser(null)
    setStatus('anonymous')
  }, [])

  // Una sesión irrecuperable (refresh rechazado) nos devuelve al login.
  useEffect(() => {
    setUnauthenticatedHandler(goAnonymous)
    return () => setUnauthenticatedHandler(null)
  }, [goAnonymous])

  useEffect(() => {
    let active = true
    void (async () => {
      const token = await refreshSession()
      if (!active) return
      if (!token) {
        setStatus('anonymous')
        return
      }
      try {
        const me = await getMe()
        if (!active) return
        setUser(me)
        setStatus('authenticated')
      } catch {
        if (active) goAnonymous()
      }
    })()
    return () => {
      active = false
    }
  }, [goAnonymous])

  const signIn = useCallback(async () => {
    window.location.href = await getGithubAuthUrl()
  }, [])

  const signOut = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      goAnonymous()
    }
  }, [goAnonymous])

  const adoptSession = useCallback(async (next: User | null) => {
    setUser(next ?? (await getMe()))
    setStatus('authenticated')
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      isAdmin: user?.role === 'admin',
      signIn,
      signOut,
      adoptSession,
    }),
    [status, user, signIn, signOut, adoptSession],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
