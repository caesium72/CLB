"use client";

import type { EvidenceGraphNode } from "@clb-acel/schemas";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { protocolColors } from "@/lib/evidence-graph-theme";

function truncateHash(hash: string | undefined, chars = 10) {
  if (!hash) return "—";
  if (hash.length <= chars * 2 + 2) return hash;
  return `${hash.slice(0, chars + 2)}…${hash.slice(-chars)}`;
}

export function EvidenceNodeDetail({ node }: { node: EvidenceGraphNode | null }) {
  if (!node) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-base">Node detail</CardTitle>
          <CardDescription>Select a node in the graph to inspect its evidence fields.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const colors = protocolColors(node.protocol);
  const metadata = node.metadata ?? {};
  const publicFields = metadata.publicFields as Record<string, unknown> | undefined;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{node.label.replace(/_/g, " ")}</CardTitle>
            <CardDescription className="font-mono text-xs">{node.id}</CardDescription>
          </div>
          <Badge variant="outline" className={colors.text}>
            {node.protocol}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-muted-foreground">Node type</p>
          <p className="font-mono text-xs">{node.nodeType}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Object hash</p>
          <p className="break-all font-mono text-xs">{node.objectHash ?? "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Event hash</p>
          <p className="break-all font-mono text-xs">{truncateHash(metadata.eventHash as string | undefined, 14)}</p>
        </div>
        {metadata.previousEventHash ? (
          <div>
            <p className="text-muted-foreground">Previous event hash</p>
            <p className="break-all font-mono text-xs">{truncateHash(metadata.previousEventHash as string, 14)}</p>
          </div>
        ) : null}
        <div>
          <p className="text-muted-foreground">Actor</p>
          <p className="break-all font-mono text-xs">{(metadata.actor as string) ?? "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Timestamp</p>
          <p className="font-mono text-xs">{(metadata.timestamp as string) ?? "—"}</p>
        </div>
        {publicFields && Object.keys(publicFields).length > 0 ? (
          <div>
            <p className="mb-1 text-muted-foreground">Public fields</p>
            <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[10px]">
              {JSON.stringify(publicFields, null, 2)}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
