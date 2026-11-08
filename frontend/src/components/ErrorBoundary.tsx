// Limite de error por ruta, convencion de la familia (competition-view envuelve
// cada Route en uno). Evita que un fallo de render deje la pantalla en blanco sin
// ninguna pista.

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm font-semibold">{this.props.title}</p>
          <p className="text-muted-foreground max-w-[32rem] text-xs">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
          >
            try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
