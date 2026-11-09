// Rutas de la aplicacion.
//
// El dashboard es la entrada: al abrir la herramienta lo primero es el estado del
// archivo, y desde ahi se salta al catalogo con el filtro que interese.

import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppShell } from "./components/layout/AppShell";
import { CatalogPage } from "./features/catalog/CatalogPage";
import AuthCallback from "./routes/AuthCallback";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { SignIn } from "./routes/SignIn";

// El catalogo entra en el bundle principal porque es la pantalla de trabajo diario.
// Las demas se cargan al visitarlas: el dashboard arrastra uPlot, y la subida y el
// equipo no los abre casi nadie en una sesion normal.
const DashboardPage = lazy(() =>
  import("./features/dashboard/DashboardPage").then((m) => ({
    default: m.DashboardPage,
  })),
);
const UploadPage = lazy(() =>
  import("./features/upload/UploadPage").then((m) => ({
    default: m.UploadPage,
  })),
);
const TeamPage = lazy(() =>
  import("./features/team/TeamPage").then((m) => ({ default: m.TeamPage })),
);
const TagsPage = lazy(() =>
  import("./features/tags/TagsPage").then((m) => ({ default: m.TagsPage })),
);
const GraphPage = lazy(() =>
  import("./features/graph/GraphPage").then((m) => ({ default: m.GraphPage })),
);
const AboutPage = lazy(() =>
  import("./features/about/AboutPage").then((m) => ({ default: m.AboutPage })),
);

/** Una pagina dentro del shell, con su propia barrera de errores. */
function Page({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <AppShell>
        <ErrorBoundary title={title}>
          <Suspense
            fallback={
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                Loading…
              </div>
            }
          >
            {children}
          </Suspense>
        </ErrorBoundary>
      </AppShell>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/"
        element={
          <Page title="The dashboard failed to render">
            <DashboardPage />
          </Page>
        }
      />
      <Route
        path="/catalog"
        element={
          <Page title="The catalog failed to render">
            <CatalogPage />
          </Page>
        }
      />
      <Route
        path="/tags"
        element={
          <Page title="The tags page failed to render">
            <TagsPage />
          </Page>
        }
      />
      <Route
        path="/graph"
        element={
          <Page title="The graph failed to render">
            <GraphPage />
          </Page>
        }
      />
      <Route
        path="/upload"
        element={
          <Page title="The upload page failed to render">
            <UploadPage />
          </Page>
        }
      />
      <Route
        path="/team"
        element={
          <Page title="The team page failed to render">
            <TeamPage />
          </Page>
        }
      />
      <Route
        path="/about"
        element={
          <Page title="The about page failed to render">
            <AboutPage />
          </Page>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
