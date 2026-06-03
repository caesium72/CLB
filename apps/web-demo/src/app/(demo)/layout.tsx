import { DemoLayoutShell } from "@/components/demo-shell";
import { DemoRunProvider } from "@/components/demo-run-provider";
import { ResearchModeProvider } from "@/components/research-mode-provider";
import { Suspense } from "react";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <ResearchModeProvider>
      <Suspense fallback={null}>
        <DemoRunProvider>
          <DemoLayoutShell>{children}</DemoLayoutShell>
        </DemoRunProvider>
      </Suspense>
    </ResearchModeProvider>
  );
}
