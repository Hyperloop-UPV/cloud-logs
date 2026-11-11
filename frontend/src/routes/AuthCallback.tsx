/** Aterrizaje de GitHub: canjea el code por una sesión y vuelve a la app. */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completeGithubLogin } from "../api/endpoints";
import { useAuth } from "../auth/useAuth";

export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { adoptSession } = useAuth();
  const [failure, setFailure] = useState<string | null>(null);
  const exchanged = useRef(false);

  const code = params.get("code");
  const state = params.get("state");
  const error =
    code && state ? failure : "GitHub no devolvió el código de autorización.";

  useEffect(() => {
    if (!code || !state) return;
    // El code de GitHub es de un solo uso: en StrictMode el efecto corre dos veces.
    if (exchanged.current) return;
    exchanged.current = true;

    void (async () => {
      try {
        const session = await completeGithubLogin(code, state);
        await adoptSession(session.user);
        void navigate("/", { replace: true });
      } catch (err) {
        setFailure(
          err instanceof Error
            ? err.message
            : "Authentication could not be completed.",
        );
      }
    })();
  }, [code, state, navigate, adoptSession]);

  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      {error ? (
        <>
          <h1 className="text-foreground text-xl font-semibold">
            Sign-in failed
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">{error}</p>
          <a
            className="text-primary mt-4 inline-block text-sm hover:underline"
            href="/"
          >
            Try again
          </a>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          Validating GitHub authentication…
        </p>
      )}
    </main>
  );
}
