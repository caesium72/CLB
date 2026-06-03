import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { preventionLayerCopy } from "@/lib/demo-copy";

/**
 * Visitor-readable badge for a `preventionLayer` value returned by the attack
 * simulator (`x402` | `predicate-guard` | `verifier` | `audit` | `none`).
 */
export function PreventionLayerBadge({ layer }: { layer: string }) {
  const copy = preventionLayerCopy(layer);
  const prevented = layer === "x402" || layer === "predicate-guard";
  const allowed = layer === "none";

  const Icon = allowed ? ShieldX : prevented ? ShieldAlert : ShieldCheck;

  return (
    <Badge
      variant={allowed ? "destructive" : prevented ? "default" : "secondary"}
      className="gap-1"
      title={copy.detail}
    >
      <Icon className="size-3.5" />
      {copy.label}
    </Badge>
  );
}
