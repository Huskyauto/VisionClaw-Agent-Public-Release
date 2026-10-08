export interface ActionBalloon {
  id: string;
  label: string;
  timestamp: number;
}

export function ActionBalloons({ balloons }: { balloons: ActionBalloon[] }) {
  const visible = balloons.slice(-4);
  if (visible.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-[60] flex flex-col gap-2 pointer-events-none" data-testid="action-balloons">
      {visible.map((b, i) => (
        <div
          key={b.id}
          className="flex items-center gap-2.5 px-4 py-2.5 bg-primary/95 text-primary-foreground rounded-xl shadow-lg backdrop-blur-sm animate-in slide-in-from-right-5 fade-in duration-500"
          style={{ animationDelay: `${i * 80}ms`, opacity: i < visible.length - 1 ? 0.7 : 1 }}
          data-testid={`action-balloon-${b.id}`}
        >
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
          <span className="text-sm font-medium">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

export function ThinkingIndicator({ name }: { name: string }) {
  return (
    <div className="flex gap-3" data-testid="thinking-indicator">
      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5 text-sm">🦞</div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{name}</span>
        <div className="bg-card border border-card-border rounded-xl rounded-tl-sm px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">Thinking...</span>
          </div>
        </div>
      </div>
    </div>
  );
}