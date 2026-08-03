import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TypographyLarge, TypographyMuted } from "@/components/ui/typography";

interface ErrorBoundaryProps {
  children: ReactNode;
  context: string;
  title: string;
  description: string;
  onClose: (() => void) | null;
  onReload: (() => void) | null;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class UnexpectedErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Unexpected UI render error", {
      component: this.props.context,
      error,
      componentStack: errorInfo.componentStack,
    });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <TypographyLarge>{this.props.title}</TypographyLarge>
        <TypographyMuted>{this.props.description}</TypographyMuted>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => this.setState({ failed: false })}
            type="button"
            variant="outline"
          >
            Try again
          </Button>
          {this.props.onClose === null ? null : (
            <Button onClick={this.props.onClose} type="button" variant="outline">
              Close AI Console
            </Button>
          )}
          {this.props.onReload === null ? null : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline">
                  Reload app
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reload Aproprose?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Reloading can discard unsaved work in this window.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={this.props.onReload}>
                    Reload app
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    );
  }
}

export function RootErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <UnexpectedErrorBoundary
      context="application"
      description="The application could not be displayed. Try again or reload the app."
      onClose={null}
      onReload={() => window.location.reload()}
      title="Something went wrong"
    >
      {children}
    </UnexpectedErrorBoundary>
  );
}

export function AiConsoleErrorBoundary({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <UnexpectedErrorBoundary
      context="AI Console"
      description="The AI Console could not be displayed. Your editor remains available."
      onClose={onClose}
      onReload={null}
      title="AI Console unavailable"
    >
      {children}
    </UnexpectedErrorBoundary>
  );
}
