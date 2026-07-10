import React, { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

export default function DataTable({ columns, data, searchFields = [], pageSize = 15, onRowClick, emptyMessage = "No records found" }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const filtered = useMemo(() => {
    let result = data || [];
    if (search && searchFields.length) {
      const lower = search.toLowerCase();
      result = result.filter(row => searchFields.some(f => String(row[f] || "").toLowerCase().includes(lower)));
    }
    if (sortCol) {
      result = [...result].sort((a, b) => {
        const av = a[sortCol] ?? "", bv = b[sortCol] ?? "";
        const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [data, search, sortCol, sortDir, searchFields]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key) => {
    if (sortCol === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(key); setSortDir("asc"); }
  };

  return (
    <div>
      {searchFields.length > 0 && (
        <div className="mb-4 relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <Input placeholder="Search..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                  className={`px-4 py-3 text-left font-semibold text-slate-600 whitespace-nowrap ${col.sortable !== false ? "cursor-pointer hover:text-slate-900" : ""} ${col.className || ""}`}
                >
                  {col.label}
                  {sortCol === col.key && (sortDir === "asc" ? " ↑" : " ↓")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">{emptyMessage}</td></tr>
            ) : paged.map((row, i) => (
              <tr
                key={row.id || i}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-slate-100 last:border-0 ${onRowClick ? "cursor-pointer hover:bg-slate-50" : ""}`}
              >
                {columns.map(col => (
                  <td key={col.key} className={`px-4 py-3 ${col.className || ""}`}>
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-slate-500">
          <span>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} />
            </Button>
            <span>Page {page + 1} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}