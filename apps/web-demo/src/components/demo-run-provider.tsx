"use client";

import type { CheckoutStage, DemoQuote, DiscoveryResult } from "@/lib/demo-types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type DemoMode = "a" | "b";
export type DemoRunStatus = "ready" | "preparing" | "signing" | "running" | "live-trace" | "error";

export type DemoRunState = {
  mode: DemoMode;
  intentId?: string;
  intentToken?: string;
  traceId?: string;
  mandateId?: string;
  runStatus: DemoRunStatus;
  error?: string;
  discovery?: DiscoveryResult;
  quote?: DemoQuote;
  checkoutStage?: CheckoutStage;
};

type DemoRunContextValue = DemoRunState & {
  setMode: (mode: DemoMode) => void;
  updateRun: (patch: Partial<DemoRunState>) => void;
  resetRun: () => void;
};

const STORAGE_KEY = "clb-acel-demo-run";

const defaultState: DemoRunState = {
  mode: "a",
  runStatus: "ready",
  checkoutStage: "idle",
};

const DemoRunContext = createContext<DemoRunContextValue | null>(null);

function readStoredState(): DemoRunState {
  if (typeof window === "undefined") return defaultState;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaultState, ...(JSON.parse(stored) as DemoRunState) } : defaultState;
  } catch {
    return defaultState;
  }
}

export function DemoRunProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<DemoRunState>(defaultState);

  useEffect(() => {
    const stored = readStoredState();
    const traceId = searchParams.get("traceId") ?? stored.traceId;
    queueMicrotask(() => {
      setState({
        ...stored,
        ...(traceId ? { traceId, runStatus: "live-trace", checkoutStage: "complete" as const } : {}),
      });
    });
  }, [searchParams]);

  useEffect(() => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (state.traceId) params.set("traceId", state.traceId);
    else params.delete("traceId");
    const next = params.toString() ? `${pathname}?${params}` : pathname;
    const current = `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`;
    if (next !== current) {
      router.replace(next, { scroll: false });
    }
  }, [pathname, router, searchParams, state.traceId]);

  const updateRun = useCallback((patch: Partial<DemoRunState>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  const setMode = useCallback((mode: DemoMode) => {
    setState((current) =>
      current.mode === mode
        ? current
        : {
            ...current,
            mode,
            mandateId: undefined,
            traceId: undefined,
            intentToken: undefined,
            discovery: undefined,
            quote: undefined,
            checkoutStage: "idle",
            runStatus: "ready",
            error: undefined,
          },
    );
  }, []);

  const resetRun = useCallback(() => {
    setState(defaultState);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const value = useMemo<DemoRunContextValue>(
    () => ({ ...state, setMode, updateRun, resetRun }),
    [resetRun, setMode, state, updateRun],
  );

  return <DemoRunContext.Provider value={value}>{children}</DemoRunContext.Provider>;
}

export function useDemoRun() {
  const context = useContext(DemoRunContext);
  if (!context) {
    throw new Error("useDemoRun must be used inside DemoRunProvider");
  }
  return context;
}
