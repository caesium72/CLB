"use client";

import { Button } from "@/components/ui/button";

type Cell = string | number | boolean;

function escapeCsv(cell: Cell): string {
  const value = String(cell);
  return /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Small client-only helper: downloads a table as CSV without a server round-trip. */
export function DownloadCsvButton({
  filename,
  rows,
}: {
  filename: string;
  rows: Array<Array<Cell>>;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        const csv = `${rows.map((row) => row.map(escapeCsv).join(",")).join("\n")}\n`;
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      Download CSV
    </Button>
  );
}
