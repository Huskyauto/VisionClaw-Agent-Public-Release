import { Link } from "wouter";
import { ArrowRight, CircleHelp, Eye, Hand, LockKeyhole, MousePointer2, RotateCcw, ShieldCheck, TimerReset } from "lucide-react";
import { useAuth } from "@/lib/auth";

const steps = [
  { icon: Eye, title: "Open a session and see the page", text: "Choose the browser session and tab, then take control. You see fresh screenshots of that page—not a video stream or continuous recording." },
  { icon: MousePointer2, title: "Navigate with intent", text: "Open an address or navigate in the selected tab, then inspect the screenshot's labeled controls. Confirm a labeled click, type into a field, scroll, or close the tab through its confirmation gate." },
  { icon: Hand, title: "Pause for a person", text: "Human control remains in force. Navigation or a disconnected session preserves the Human pause; the agent does not quietly take over." },
  { icon: ShieldCheck, title: "Hand back deliberately", text: "A handback is verified against the active browser state and a fresh agent snapshot. If verification cannot be completed, control is not silently handed over." },
];

export default function BrowserWorkbenchPage() {
  const { tenant, isChecking } = useAuth();
  if (isChecking) return <main className="mx-auto max-w-6xl p-6"><div className="h-8 w-56 animate-pulse rounded bg-muted" /><div className="mt-5 h-64 animate-pulse rounded-2xl bg-muted" /></main>;
  if (!tenant) return <main className="mx-auto max-w-3xl p-8"><h1 className="text-2xl font-semibold">Sign in to use Browser Workbench</h1><p className="mt-2 text-muted-foreground">Your browser sessions and file library belong to your account.</p></main>;
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground md:px-8 md:py-9">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">BOB'S BROWSER WORKBENCH</p><h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">A careful hand on the browser.</h1></div>
          <Link href="/browser-workspace" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Open browser controls <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.06] p-6 md:p-10">
          <div className="absolute right-8 top-8 hidden h-32 w-32 rounded-full border border-primary/15 md:block" />
          <div className="absolute right-16 top-16 hidden h-16 w-16 rounded-full border border-primary/20 md:block" />
          <div className="relative max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-background/60 px-3 py-1.5 text-xs font-medium text-primary"><CircleHelp className="h-3.5 w-3.5" /> Human-led browser operation</span>
            <p className="mt-5 text-lg leading-8 text-foreground/85 md:text-xl">Take control of a Camofox browser through screenshots and labeled page controls. Navigate a page, click, type, and scroll yourself—then make an explicit, verified handback when you are ready.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/browser-workspace" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Go to browser controls <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/browser-workbench/files" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold hover:bg-muted">Open workbench files</Link>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-5 flex items-end justify-between"><div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">THE CONTROL LOOP</p><h2 className="mt-2 text-2xl font-semibold">A deliberate four-step session</h2></div><span className="hidden text-sm text-muted-foreground md:block">No autonomous browser loop</span></div>
          <div className="grid gap-3 md:grid-cols-2">
            {steps.map(({ icon: Icon, title, text }, index) => <article key={title} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span><span className="font-mono text-xs text-muted-foreground">0{index + 1}</span><h3 className="font-semibold">{title}</h3></div>
              <p className="mt-3 pl-12 text-sm leading-6 text-muted-foreground">{text}</p>
            </article>)}
          </div>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
          <article className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-primary"><LockKeyhole className="h-4 w-4" /><h2 className="font-semibold text-foreground">Isolation and session boundaries</h2></div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">The selected browser session stays distinct from desktop operating-system controls; the agent receives no expanded browser mutation authority through this library. Human pause is preserved when navigation changes the page or the connection drops. An expired session needs recovery in browser controls; an ended job is not automatically resumed.</p>
          </article>
          <article className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-primary"><RotateCcw className="h-4 w-4" /><h2 className="font-semibold text-foreground">Files stay explicit</h2></div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Browser downloads are never imported automatically. Upload or explicitly add a file from My Vault to organize a reference here. Removing that reference never deletes the Vault file.</p>
            <Link href="/browser-workbench/files" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline">Organize workbench files <ArrowRight className="h-4 w-4" /></Link>
          </article>
        </section>

        <section className="mt-4 flex flex-col gap-4 rounded-xl border border-border bg-muted/40 p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex gap-3"><TimerReset className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /><div><h2 className="font-semibold">Camofox only. No desktop or auto-import.</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">This is not a general-purpose operating-system remote control. Browser downloads must be saved and added by you; there are no filesystem mounts or public file links.</p></div></div>
          <Link href="/browser-workspace" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold hover:bg-muted">Open controls <ArrowRight className="h-4 w-4" /></Link>
        </section>
      </div>
    </main>
  );
}