import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorState({ title = "Something went wrong", message = "Failed to load data. Please try again.", onRetry, compact = false }: ErrorStateProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20" data-testid="error-state-compact">
        <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
        <span className="text-sm text-destructive">{message}</span>
        {onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry} className="ml-auto shrink-0 h-7 px-2" data-testid="button-retry-compact">
            <RefreshCw className="w-3 h-3" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center" data-testid="error-state">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertTriangle className="w-6 h-6 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold mb-1" data-testid="text-error-title">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm" data-testid="text-error-message">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} data-testid="button-retry">
          <RefreshCw className="w-4 h-4 mr-2" />
          Try Again
        </Button>
      )}
    </div>
  );
}
