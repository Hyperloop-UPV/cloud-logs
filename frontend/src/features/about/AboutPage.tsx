// Quien ha hecho esto.
//
// Las dos personas van en una rejilla de dos columnas con tarjetas identicas: sin
// orden que insinue jerarquia, que es como lo pidieron. Manel primero.
//
// Se separan dos cosas que no son lo mismo: el **cargo** es el que cada uno tiene
// en el equipo, y el **aporte** es lo que construyo en esta aplicacion. Mezclarlos
// daria cargos que nadie tiene.

import { Card, CardContent } from "@hyperloopupv/frontend-kit/components";
import { ExternalLink } from "@hyperloopupv/frontend-kit/icons";
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../../api/endpoints";
import { Globe } from "lucide-react";
import { Ampersand } from "../../components/brand/Ampersand";
import { GithubMark } from "../../components/brand/GithubMark";
import { SoftwareMark } from "../../components/brand/SoftwareMark";
import { TeamLogo } from "../../components/brand/TeamLogo";
import { PageHeader } from "../../components/layout/PageHeader";

interface Person {
  name: string;
  /**
   * Cargo en el equipo. Se parte en tres para poder meter el ampersand con su
   * propia tipografia: el de Archivo tiene un dibujo que distrae.
   */
  role: [string, string] | [string];
  /** Lo que construyo en esta aplicacion. */
  built: [string, string] | [string];
  github: string;
  website?: string;
}

const PEOPLE: Person[] = [
  {
    name: "Manel Romero",
    role: ["Digital Solutions Engineer"],
    built: ["Backend ", " Architecture"],
    github: "Manel-Romero",
  },
  {
    name: "Javier Ribal del Río",
    role: ["Software ", " Firmware Project Manager"],
    built: ["Frontend"],
    github: "JavierRibaldelRio",
    website: "ribal.dev",
  },
];

/** Une las dos mitades con el ampersand de buena forma. */
function Joined({ parts }: { parts: [string, string] | [string] }) {
  if (parts.length === 1) return <>{parts[0]}</>;
  return (
    <>
      {parts[0]}
      <Ampersand />
      {parts[1]}
    </>
  );
}

/** El repositorio de la herramienta. */
const REPO = "Hyperloop-UPV/cloud-logs";

const STACK = [
  ["Frontend", "React 19 · Vite · TypeScript · Tailwind"],
  ["Backend", "FastAPI · SQLAlchemy 2.0 · Pydantic v2"],
  ["Storage", "SQLite for metadata · Google Drive for archives"],
  ["Auth", "GitHub OAuth · rotating refresh tokens"],
];

function PersonCard({ person }: { person: Person }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div>
          <p className="text-base font-semibold">{person.name}</p>
          <p className="text-muted-foreground text-xs">
            <Joined parts={person.role} />
          </p>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
            Built
          </span>
          <span className="text-sm">
            <Joined parts={person.built} />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a
            href={`https://github.com/${person.github}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-xs transition-colors"
          >
            <GithubMark className="size-3.5 shrink-0" />
            {person.github}
            <ExternalLink className="size-3 opacity-60" />
          </a>
          {person.website && (
            <a
              href={`https://${person.website}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-xs transition-colors"
            >
              <Globe className="size-3.5 shrink-0" />
              {person.website}
              <ExternalLink className="size-3 opacity-60" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function AboutPage() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });

  return (
    <>
      <PageHeader title="About" />

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[52rem] flex-col gap-6 p-4">
          <section className="rounded-xl border px-5 py-6">
            <div>
              <div className="flex items-center gap-2.5">
                <TeamLogo size={28} />
                <span className="text-xs font-semibold tracking-wider uppercase">
                  Hyperloop UPV Software H12
                </span>
              </div>
              <h2 className="mt-3 text-2xl font-bold tracking-tight">
                Cloud Logs
              </h2>
              <p className="text-muted-foreground mt-2 max-w-[42rem] text-sm">
                The catalogue for the pod's telemetry and diagnostic archives.
                Every run that leaves the test bench is registered here with its
                time window, its tags and its author, while the archive itself
                is uploaded straight to Google Drive — this service only keeps
                track of what exists and where it lives.
              </p>
              {/* El repositorio va en la presentacion y no entre los enlaces de
                  servicio: es donde vive la herramienta, no un recurso mas. */}
              <a
                href={`https://github.com/${REPO}`}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground mt-4 inline-flex w-fit items-center gap-1.5 text-xs transition-colors"
              >
                <GithubMark className="size-3.5 shrink-0" />
                {REPO}
                <ExternalLink className="size-3 opacity-60" />
              </a>
            </div>
          </section>

          <section>
            <h3 className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
              Built by
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {PEOPLE.map((person) => (
                <PersonCard key={person.github} person={person} />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
              How it is built
            </h3>
            <dl className="divide-y rounded-xl border text-sm">
              {STACK.map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-4"
                >
                  <dt className="text-muted-foreground w-24 shrink-0 text-xs">
                    {label}
                  </dt>
                  <dd className="text-xs">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h3 className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
              Service
            </h3>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-4 py-3 text-xs">
              <span className="flex items-center gap-2">
                <span
                  className={
                    health.data?.status === "healthy"
                      ? "size-1.5 rounded-full bg-emerald-500"
                      : health.isError
                        ? "size-1.5 rounded-full bg-red-500"
                        : "bg-muted-foreground/40 size-1.5 rounded-full"
                  }
                  aria-hidden
                />
                {health.isPending
                  ? "Checking…"
                  : health.isError
                    ? "API unreachable"
                    : `API ${health.data?.status}`}
              </span>
              {health.data && (
                <>
                  <span className="text-muted-foreground">
                    Database {health.data.components.database}
                  </span>
                  <span className="text-muted-foreground">
                    Environment {health.data.environment}
                  </span>
                </>
              )}
            </div>
          </section>

          {/* Firma. El logotipo va aqui y a tamaño legible, no de marca de agua:
              es de quien ha hecho la herramienta y cierra la pagina. */}
          <footer className="flex flex-col items-center gap-3 border-t pt-8 pb-4">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase">
              Software H12
            </span>
            <SoftwareMark className="h-16 w-auto opacity-90" />
          </footer>
        </div>
      </div>
    </>
  );
}
