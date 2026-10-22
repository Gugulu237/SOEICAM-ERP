// Shelf reports measure retail sell-through; they are not company invoices.
export function hotessePerformance(reports = [], date = '') {
  const daily = reports.filter(row => row.report_type === 'daily_sales' && row.visit_date >= date.slice(0, 8) + '01' && row.visit_date <= date);
  const products = new Map();
  for (const report of daily) for (const line of report.lines || []) {
    const unit = line.unit || 'units', key = JSON.stringify([line.product_id, unit]);
    const row = products.get(key) || { key, product_id: line.product_id, name: line.product_name, unit, sold: 0, damaged: 0 };
    row.sold = Math.round((row.sold + Math.max(0, Number(line.sold_quantity) || 0)) * 1000) / 1000;
    row.damaged = Math.round((row.damaged + Math.max(0, Number(line.damaged_quantity) || 0)) * 1000) / 1000;
    products.set(key, row);
  }
  return { submitted: daily.length, reviewed: daily.filter(row => row.status === 'reviewed').length,
    reportedToday: new Set(daily.filter(row => row.visit_date === date).map(row => row.location_id)).size,
    products: [...products.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))) };
}
