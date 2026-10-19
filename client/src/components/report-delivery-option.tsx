type Props = { id: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean };

export function ReportDeliveryOption({ id, checked, onChange, disabled }: Props) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <label htmlFor={id} className="flex min-h-11 items-center gap-3 text-sm font-medium cursor-pointer">
        <input id={id} type="checkbox" checked={checked} disabled={disabled}
          onChange={event => onChange(event.target.checked)} aria-describedby={`${id}-help`}
          className="h-5 w-5 shrink-0 accent-primary" data-testid={id} />
        Report only — no customer email or customer charge
      </label>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        Leave checked to download the finished PDF and email it yourself. No customer delivery email,
        checkout, invoice or payment record is created. AI generation costs still apply.
        Uncheck only to prepare customer delivery in your approval queue.
      </p>
    </div>
  );
}
