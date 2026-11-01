import { Fragment } from "react";

type PlanReviewDetailsProps = {
  steps: unknown;
  planDetails?: unknown;
};

function labelFor(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function StructuredValue({ value, seen = new WeakSet<object>() }: { value: unknown; seen?: WeakSet<object> }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/70">Not provided</span>;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  }

  if (typeof value !== "object") {
    return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  }

  if (seen.has(value)) {
    return <span className="text-muted-foreground/70">Repeated value omitted</span>;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      seen.delete(value);
      return <span className="text-muted-foreground/70">None</span>;
    }
    const rendered = (
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {value.map((item, index) => (
          <li key={index} className="min-w-0 break-words">
            <StructuredValue value={item} seen={seen} />
          </li>
        ))}
      </ul>
    );
    seen.delete(value);
    return rendered;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    seen.delete(value);
    return <span className="text-muted-foreground/70">No details</span>;
  }

  const rendered = (
    <dl className="mt-1 grid min-w-0 gap-2 sm:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)]">
      {entries.map(([key, nestedValue]) => (
        <Fragment key={key}>
          <dt className="break-words font-medium text-foreground/75">{labelFor(key)}</dt>
          <dd className="min-w-0 break-words">
            <StructuredValue value={nestedValue} seen={seen} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
  seen.delete(value);
  return rendered;
}

function getSteps(steps: unknown): unknown[] {
  return Array.isArray(steps) ? steps : [];
}

export default function PlanReviewDetails({ steps, planDetails }: PlanReviewDetailsProps) {
  const allSteps = getSteps(steps);

  return (
    <details className="group min-w-0 rounded-md border border-border/70 bg-muted/20">
      <summary className="cursor-pointer select-none rounded-md px-3 py-2.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <span>Review complete plan</span>
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {allSteps.length} {allSteps.length === 1 ? "step" : "steps"}
        </span>
      </summary>
      <div className="space-y-4 border-t border-border/70 px-3 py-3">
        {planDetails !== undefined && (
          <section aria-label="Additional plan details" className="min-w-0">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plan details</h4>
            <div className="mt-2 min-w-0 break-words text-xs leading-relaxed">
              <StructuredValue value={planDetails} />
            </div>
          </section>
        )}

        <section aria-label="All plan steps" className="min-w-0">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">All steps</h4>
          {allSteps.length > 0 ? (
            <ol className="mt-2 space-y-2">
              {allSteps.map((step, index) => {
                const stepNumber =
                  step !== null && typeof step === "object" && !Array.isArray(step) &&
                  ("n" in step) && (typeof (step as { n?: unknown }).n === "string" || typeof (step as { n?: unknown }).n === "number")
                    ? String((step as { n: string | number }).n)
                    : String(index + 1);

                return (
                  <li key={`${stepNumber}-${index}`} className="min-w-0 rounded border border-border/60 bg-background/60 p-2.5">
                    <div className="text-xs font-semibold text-foreground">Step {stepNumber}</div>
                    <div className="mt-1 min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                      <StructuredValue value={step} />
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No step details are available for this plan.</p>
          )}
        </section>
      </div>
    </details>
  );
}
