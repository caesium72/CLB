import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DelegationQuote } from "@/lib/demo-types";

export function DelegationLimitsCard({ quote }: { quote: DelegationQuote }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Spending limits
          <Badge variant="outline">Not paid yet</Badge>
        </CardTitle>
        <CardDescription>{quote.note}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Task</span>
          <span className="text-right">{quote.product}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Max spend</span>
          <span className="font-semibold">
            {quote.maxValue} {quote.asset}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Merchant</span>
          <span>{quote.merchantName}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Allowed payees</span>
          <p className="mt-1 font-mono text-xs break-all">{quote.allowedPayees.join(", ")}</p>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Valid until</span>
          <span className="font-mono text-xs">{quote.validUntil}</span>
        </div>
      </CardContent>
    </Card>
  );
}
