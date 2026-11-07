/** Provisional: confirma que la sesión y el API responden. Sin UI definitiva. */

import { useQuery } from '@tanstack/react-query'
import { getHealth, getStats } from '../api/endpoints'
import { useAuth } from '../auth/useAuth'

export default function Home() {
  const { status, user, isAdmin, signIn, signOut } = useAuth()

  const health = useQuery({ queryKey: ['health'], queryFn: getHealth })
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    enabled: status === 'authenticated',
  })

  if (status === 'loading') {
    return <main className="px-6 py-24 text-ink-soft">Comprobando sesión…</main>
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl">Cloud Logs</h1>
      <p className="mt-1 text-ink-soft">Catálogo de telemetría · Hyperloop UPV</p>

      <dl className="mt-8 border-t border-rule text-sm">
        <div className="flex justify-between border-b border-rule-soft py-2">
          <dt className="text-ink-soft">API</dt>
          <dd className="font-mono tnum">
            {health.isPending ? '…' : (health.data?.status ?? 'sin respuesta')}
          </dd>
        </div>
        <div className="flex justify-between border-b border-rule-soft py-2">
          <dt className="text-ink-soft">Sesión</dt>
          <dd className="font-mono">
            {status === 'authenticated' ? `${user?.username} (${user?.role})` : 'sin iniciar'}
          </dd>
        </div>
        {status === 'authenticated' && (
          <div className="flex justify-between border-b border-rule-soft py-2">
            <dt className="text-ink-soft">Logs en catálogo</dt>
            <dd className="font-mono tnum">
              {stats.isPending ? '…' : (stats.data?.totalLogs ?? '—')}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-8">
        {status === 'authenticated' ? (
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded border border-rule px-3 py-1.5 hover:bg-accent-weak"
          >
            Cerrar sesión
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void signIn()}
            className="rounded bg-accent px-3 py-1.5 text-white hover:opacity-90"
          >
            Entrar con GitHub
          </button>
        )}
      </div>

      {isAdmin && <p className="mt-4 text-sm text-ink-faint">Tienes permisos de administrador.</p>}
    </main>
  )
}
