import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sort?: (row: T) => string | number;
  align?: "left" | "right";
  className?: string;
  /** Hide below this breakpoint. */
  hideBelow?: "sm" | "md" | "lg";
}

export function DataTable<T>({ rows, columns, rowKey, onRowClick, pageSize = 25, initialSort, empty, dense }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; pageSize?: number; initialSort?: { key: string; dir: "asc" | "desc" }; empty?: ReactNode; dense?: boolean }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const s = [...rows].sort((a, b) => {
      const x = col.sort!(a), y = col.sort!(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return sort.dir === "desc" ? s.reverse() : s;
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const p = Math.min(page, pages - 1);
  const view = sorted.slice(p * pageSize, (p + 1) * pageSize);
  const hide = (h?: string) => (h === "sm" ? "hidden sm:table-cell" : h === "md" ? "hidden md:table-cell" : h === "lg" ? "hidden lg:table-cell" : "");

  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("font-medium px-5 py-2.5 whitespace-nowrap", c.align === "right" ? "text-right" : "text-left", hide(c.hideBelow), c.className)}>
                  {c.sort ? (
                    <button className={cn("inline-flex items-center gap-1 hover:text-fg", c.align === "right" && "flex-row-reverse")} onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: "desc" }))}>
                      {c.header}
                      {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {view.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn("transition-colors", onRowClick && "cursor-pointer hover:bg-surface-2")} tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(r) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-5 whitespace-nowrap", dense ? "py-2" : "py-3", c.align === "right" && "text-right tabular", hide(c.hideBelow), c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-line text-xs text-muted">
          <span className="tabular">{p * pageSize + 1}–{Math.min((p + 1) * pageSize, sorted.length)} of {sorted.length.toLocaleString()}</span>
          <div className="flex gap-1">
            <button className="p-1.5 rounded-md hover:bg-surface-2 disabled:opacity-40" disabled={p === 0} onClick={() => setPage(p - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></button>
            <button className="p-1.5 rounded-md hover:bg-surface-2 disabled:opacity-40" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} aria-label="Next page"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
