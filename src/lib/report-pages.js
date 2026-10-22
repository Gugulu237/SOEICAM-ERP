// Fail rather than silently issuing a document with missing or duplicate pages.
export async function loadReportPages(load,key) {
  const rows=[],ids=new Set();
  let page=1,expected;
  for(;;page++) {
    const result=await load(page);
    if(!Array.isArray(result[key])) throw new Error('The report could not be fully loaded. Retry.');
    if(expected===undefined) expected=result.total;
    if(expected!==undefined && result.total!==expected) throw new Error('Records changed while exporting. Retry.');
    for(const row of result[key]) {
      if(row.id && ids.has(row.id)) throw new Error('Records changed while exporting. Retry.');
      if(row.id)ids.add(row.id);rows.push(row);
    }
    if(!result.has_more) break;
    if(!result[key].length) throw new Error('The report could not be fully loaded. Retry.');
  }
  if(Number.isFinite(expected) && rows.length!==expected) throw new Error('Records changed while exporting. Retry.');
  return rows;
}
