import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CartQuote } from "@/lib/demo-types";

export function CartQuoteCard({ quote }: { quote: CartQuote }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {quote.product}
          <Badge variant="secondary">Live quote</Badge>
        </CardTitle>
        <CardDescription>From {quote.merchantName}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Merchant price</span>
          <span className="font-semibold">
            {quote.price} {quote.asset}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Max authorized</span>
          <span>
            {quote.maxAmount} {quote.asset}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Network</span>
          <span>{quote.network}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Payee</span>
          <p className="mt-1 font-mono text-xs break-all">{quote.payee}</p>
        </div>
      </CardContent>
    </Card>
  );
}
