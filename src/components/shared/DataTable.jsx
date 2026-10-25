import { usePhoneLayout } from '@/hooks/usePhoneLayout';
import ReportExport from '@/components/shared/ReportExport';
import { tableReport } from '@/lib/report-models';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useMemo } from "react";
import { usePageState } from '@/lib/navigation-context';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

export default function DataTable({ columns, data, searchFields = [], pageSize = 15, onRowClick, emptyMessage = ui("No records found"), stateKey, exportTitle, exportColumns, exportMetadata = [], exportNotes = [], exportDisabled = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const phone = usePhoneLayout();

  const [view, setView] = usePageState('table:' + (stateKey || columns.map(column => column.key).join('|')), { search: '', page: 0, sortCol: null, sortDir: 'asc' });
  const { search, page, sortCol, sortDir } = view;
  const setSearch = search => setView(previous => ({ ...previous, search, page: 0 }));

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
  const currentPage = Math.min(Math.max(0, page), Math.max(0, totalPages - 1));
  const paged = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const handleSort = (key) => {
    setView(previous => ({ ...previous, sortCol: key, sortDir: previous.sortCol === key && previous.sortDir === 'asc' ? 'desc' : 'asc' }));
  };

  const primary = columns.find(col => ["business_name", "full_name", "recipe_name", "product_name", "customer_name", "employee_name", "supplier_name", "name", "title", "document_number", "invoice_number", "order_number", "account_name"].includes(col.key)) || columns.find(col => col.label && !["actions", "selected"].includes(col.key)) || columns[0];
  const cell = (col, row) => col.render ? col.render(row[col.key], row) : row[col.key];
  return (
    <div className="min-w-0">
      {searchFields.length > 0 && (
        <div className="mb-4 relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <Input aria-label={ui("Search records")} placeholder={ui("Search...")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      )}
      {exportTitle && <div className="mb-3"><ReportExport disabled={exportDisabled} getReport={() => tableReport(exportTitle, exportColumns || columns, filtered, [...exportMetadata, ["Search", search || "All records"], ["Sort", sortCol ? `${sortCol} (${sortDir})` : "Default"], ["Records", filtered.length]], exportNotes)} /></div>}
      {phone ? <div data-phone-records className="space-y-3">
        {columns.some(col => col.sortable !== false && col.label) && <div className="flex min-w-0 items-center gap-2"><select aria-label={ui('Sort records')} value={sortCol || ''} className="h-11 min-w-0 flex-1 rounded-lg border bg-white px-3 text-sm" onChange={event => setView(previous => ({ ...previous, sortCol: event.target.value || null, page: 0 }))}><option value="">{ui('Default order')}</option>{columns.filter(col => col.sortable !== false && col.label).map(col => <option key={col.key} value={col.key}>{col.label}</option>)}</select><Button variant="outline" disabled={!sortCol} aria-label={ui('Reverse sort order')} onClick={() => setView(previous => ({ ...previous, sortDir: previous.sortDir === 'asc' ? 'desc' : 'asc' }))}>{sortDir === 'asc' ? '↑' : '↓'}</Button></div>}
        {!paged.length && <p className="rounded-xl border bg-white p-6 text-center text-sm text-slate-500">{emptyMessage}</p>}
        {paged.map((row, index) => <article key={row.id || index} className="min-w-0 rounded-xl border bg-white p-4"><div className="mb-3 min-w-0 border-b pb-3 font-semibold text-slate-900">{onRowClick ? <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left" aria-label={ui('Open record {0}', row[primary?.key] || index + 1)} onClick={() => onRowClick(row)}><span className="min-w-0 break-words">{row[primary?.key] || ui('Record {0}', index + 1)}</span><ChevronRight size={18} className="shrink-0 text-primary" /></button> : cell(primary, row)}</div><dl className="grid min-w-0 grid-cols-1 gap-3 min-[380px]:grid-cols-2">{columns.filter(col => col !== primary || onRowClick && col.render).map(col => <div key={col.key} className={'min-w-0 ' + (!col.label ? 'col-span-full' : '')}><dt className={col.label ? 'mb-1 text-xs text-slate-500' : 'sr-only'}>{col.label || ui('Actions')}</dt><dd className="min-w-0 break-words text-sm text-slate-900">{cell(col, row)}</dd></div>)}</dl></article>)}
      </div> : <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
      </div>}
      {totalPages > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>{filtered.length}{ui(" record")}{filtered.length !== 1 ? "s" : ""}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" aria-label={ui("Previous records")} disabled={currentPage === 0} onClick={() => setView(previous => ({ ...previous, page: currentPage - 1 }))}>
              <ChevronLeft size={14} />
            </Button>
            <span>{ui("Page ")}{currentPage + 1}{ui(" of ")}{totalPages}</span>
            <Button variant="outline" size="sm" aria-label={ui("Next records")} disabled={currentPage >= totalPages - 1} onClick={() => setView(previous => ({ ...previous, page: currentPage + 1 }))}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
