import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MANDATE_FORMULAS } from "@/lib/demo-copy";

export function MandateFormulaPanel({ mode }: { mode: "a" | "b" }) {
  const copy = mode === "b" ? MANDATE_FORMULAS.modeB : MANDATE_FORMULAS.modeA;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{copy.title}</CardTitle>
        <CardDescription>Binding formulas for this authorization step</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          {copy.steps.map((step) => (
            <li key={step} className="font-mono text-xs break-all sm:text-sm">
              {step}
            </li>
          ))}
        </ol>
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Wallet signature
          </p>
          <p className="font-mono text-xs break-all leading-relaxed">{copy.signature}</p>
        </div>
      </CardContent>
    </Card>
  );
}
