"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDemoRun } from "@/components/demo-run-provider";
import { ModeSwitch } from "@/components/mode-switch";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useResearchMode } from "@/components/research-mode-provider";
import { demoActs, demoSteps, getAct, getDemoStep } from "@/lib/demo-nav";
import { MODE_THEME } from "@/lib/mode-theme";
import { cn } from "@/lib/utils";

function SidebarNav({
  pathname,
  onNavigate,
  className,
}: {
  pathname: string;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <nav className={cn("space-y-5 p-3", className)}>
      {demoActs.map((act) => (
        <div key={act.id} className="space-y-1">
          <div className="px-3 pb-1">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              {act.kicker}
            </p>
            <p className="text-sm font-semibold text-sidebar-foreground">{act.title}</p>
          </div>
          {act.steps.map((step) => {
            const active = pathname === step.href;
            const Icon = step.icon;

            return (
              <Link
                key={step.href}
                href={step.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{step.label}</span>
                  <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">
                    {step.navHint}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function ResearchModeToggle({ idPrefix = "" }: { idPrefix?: string }) {
  const { enabled, setEnabled } = useResearchMode();
  const id = `${idPrefix}research-mode`;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-base font-semibold">
          Research mode
        </Label>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Show hashes and protocol objects
        </p>
      </div>
      <Switch id={id} checked={enabled} onCheckedChange={setEnabled} />
    </div>
  );
}

function SidebarBrand({ className }: { className?: string }) {
  const { mode } = useDemoRun();
  const theme = MODE_THEME[mode];

  return (
    <div className={cn("flex flex-col justify-center", className)}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        CLB-ACEL Demo
      </p>
      <h1 className="mt-1 flex items-center gap-2 font-heading text-base font-semibold tracking-tight">
        <span className={cn("size-2 shrink-0 rounded-full", theme.solid)} />
        {theme.short}
      </h1>
      <p className="mt-1 text-sm leading-snug text-muted-foreground">{theme.research}</p>
    </div>
  );
}

function DesktopPageHeader({ step }: { step: NonNullable<ReturnType<typeof getDemoStep>> }) {
  const { mode, runStatus, checkoutStage } = useDemoRun();
  const theme = MODE_THEME[mode];
  const ModeIcon = theme.icon;
  const statusLabel =
    runStatus === "live-trace"
      ? "Live trace"
      : checkoutStage === "settling" || checkoutStage === "probing_402"
        ? "Agent paying"
        : runStatus === "running"
          ? "Running"
          : runStatus === "signing"
            ? "Signing"
            : "Ready";

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {getAct(step.act).kicker} · {getAct(step.act).title}
        </p>
        <h2 className="mt-0.5 font-heading text-xl font-semibold tracking-tight">{step.title}</h2>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">{step.pageDescription}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <ModeSwitch />
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
            theme.chipClass,
          )}
        >
          <ModeIcon className="size-3.5" />
          {theme.plain}
        </span>
        <Badge variant="secondary" className="w-fit">
          {statusLabel}
        </Badge>
      </div>
    </div>
  );
}

function MobileStepPills({ pathname }: { pathname: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef(new Map<string, HTMLAnchorElement>());
  const isFirstRender = useRef(true);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const activePill = pillRefs.current.get(pathname);
    if (!container || !activePill) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const pillLeft = activePill.offsetLeft;
    const pillWidth = activePill.offsetWidth;
    const targetScrollLeft = pillLeft - containerRect.width / 2 + pillWidth / 2;

    container.scrollTo({
      left: Math.max(0, targetScrollLeft),
      behavior: isFirstRender.current ? "auto" : "smooth",
    });

    isFirstRender.current = false;
  }, [pathname]);

  return (
    <div
      ref={scrollRef}
      className="scrollbar-none overflow-x-auto border-t border-border px-4 py-2 [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-max gap-2">
        {demoSteps.map((step) => {
          const active = pathname === step.href;
          return (
            <Link
              key={step.href}
              ref={(element) => {
                if (element) {
                  pillRefs.current.set(step.href, element);
                } else {
                  pillRefs.current.delete(step.href);
                }
              }}
              href={step.href}
              scroll={false}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {step.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Persistent shell — lives in (demo)/layout so mobile nav scroll survives route changes. */
export function DemoLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mode, runStatus } = useDemoRun();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const currentStep = getDemoStep(pathname);
  const theme = MODE_THEME[mode];

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <header className="z-40 shrink-0 border-b border-border bg-background lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger
              render={<Button variant="outline" size="icon-sm" aria-label="Open navigation menu" />}
            >
              <Menu className="size-4" />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex h-full w-[min(100vw-2rem,20rem)] flex-col gap-0 overflow-hidden p-0"
            >
              <SheetHeader className="shrink-0 border-b border-border px-5 py-4 text-left">
                <SheetTitle>CLB-ACEL Demo</SheetTitle>
                <SheetDescription>{theme.short} protocol walkthrough</SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <SidebarNav pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
              </div>
              <div className="shrink-0 border-t border-border px-4 py-3">
                <ResearchModeToggle idPrefix="mobile-" />
              </div>
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">
              {currentStep ? currentStep.label : "CLB-ACEL Demo"}
            </p>
            <p className="truncate text-sm leading-snug text-muted-foreground">
              {currentStep?.pageDescription ?? "Protocol walkthrough"}
            </p>
          </div>

          <Badge variant="secondary" className="shrink-0 gap-1.5 text-xs">
            <span className={cn("size-1.5 rounded-full", theme.solid)} />
            {runStatus === "live-trace" ? "Trace" : theme.short}
          </Badge>
        </div>

        <div className="border-t border-border px-4 py-2">
          <ModeSwitch compact />
        </div>

        <MobileStepPills pathname={pathname} />
      </header>

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
        <div className="hidden shrink-0 border-b border-border bg-sidebar px-5 py-4 text-sidebar-foreground lg:block">
          <SidebarBrand />
        </div>

        <header className="hidden shrink-0 border-b border-border px-6 py-4 lg:flex lg:items-center lg:px-8">
          {currentStep ? (
            <DesktopPageHeader step={currentStep} />
          ) : (
            <div className="min-w-0">
              <h2 className="font-heading text-xl font-semibold tracking-tight">CLB-ACEL Demo</h2>
            </div>
          )}
        </header>

        <aside className="hidden min-h-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground lg:flex">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <SidebarNav pathname={pathname} />
          </div>
          <div className="shrink-0 border-t border-sidebar-border px-4 py-3">
            <ResearchModeToggle idPrefix="desktop-" />
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function ProtocolPanel({ label, data }: { label: string; data: Record<string, unknown> }) {
  const { enabled } = useResearchMode();

  if (!enabled) {
    return (
      <p className="text-base leading-relaxed text-muted-foreground">
        Enable research mode to inspect protocol objects.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 sm:p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <pre className="max-w-full overflow-x-auto font-mono text-sm leading-relaxed">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export function DemoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="shrink-0 text-base font-semibold">{title}</h3>
        <Separator className="min-w-0 flex-1" />
      </div>
      {children}
    </section>
  );
}

export function ResponsiveTable({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1 overflow-x-auto px-1">{children}</div>;
}
