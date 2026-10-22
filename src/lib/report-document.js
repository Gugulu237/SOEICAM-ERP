// One immutable report snapshot feeds both the print view and the Excel workbook.
// Strings are always inline text cells, including user input beginning with '='.
const encoder = new TextEncoder();
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
export const escapeReportText = value => clean(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function reportSnapshot(report) {
  if (!report?.title || !Array.isArray(report.sections) || !report.sections.length) throw new Error('No report is available to export.');
  const snapshot = structuredClone({ ...report, generatedAt: report.generatedAt || new Date().toISOString() });
  for (const section of snapshot.sections) {
    if (!section.columns?.length || !Array.isArray(section.rows)) throw new Error('Invalid report section.');
    if (section.columns.length > 16384) throw new Error('This report exceeds the Excel column limit. Narrow the report filters.');
    for (const row of [...section.rows, ...(section.totals || [])]) {
      if (!Array.isArray(row) || row.length > section.columns.length) throw new Error('Invalid report row.');
      for (const value of row) {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('A report value is invalid. Review the source data.');
        if (value != null && !['string','number','boolean'].includes(typeof value)) throw new Error('Report cells must contain text or numbers.');
        if (clean(value).length > 32767) throw new Error('A report cell exceeds the Excel text limit.');
      }
    }
  }
  return snapshot;
}
export function reportFilename(report, extension) {
  return `${clean(report.title).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'report'}-${report.generatedAt.slice(0,10)}.${extension}`;
}
const columnLabel = column => typeof column === 'string' ? column : column.label;
const display = (value, column) => typeof value === 'number'
  ? new Intl.NumberFormat('en-CM', {maximumFractionDigits: column?.type === 'money' ? 2 : 10, minimumFractionDigits: column?.type === 'money' ? 2 : 0}).format(value)
  : String(value ?? '');
export function reportPrintHtml(input) {
  const r = reportSnapshot(input), e = escapeReportText;
  const rows = (data, columns, tag='td') => data.map(row => `<tr>${columns.map((column,i) => `<${tag} class="${typeof row[i] === 'number'?'number':''}">${e(display(row[i],column))}</${tag}>`).join('')}</tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(reportFilename(r,'pdf'))}</title><style>
  @page{size:A4 landscape;margin:14mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#172033;margin:24px}h1{font-size:22px;margin:8px 0}h2{font-size:15px;margin:24px 0 8px}header{border-bottom:2px solid #172033;padding-bottom:12px}p{margin:6px 0}dl{display:flex;gap:8px 24px;flex-wrap:wrap}dl div{display:flex;gap:6px}dt{font-weight:bold}dd{margin:0}table{border-collapse:collapse;width:100%;table-layout:auto}th,td{padding:6px;border:1px solid #cbd5e1;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef2f6}thead{display:table-header-group}tfoot{display:table-row-group;font-weight:bold;background:#f8fafc}tr{break-inside:avoid}.number{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.notes{padding:10px;border-left:3px solid #d97706;background:#fffbeb;white-space:pre-wrap}footer{margin-top:18px;color:#475569}.toolbar{position:sticky;top:0;background:white;padding:12px 0}button{padding:8px 16px;cursor:pointer}@media print{body{margin:0}.toolbar{display:none}}
  </style></head><body><div class="toolbar"><button id="report-print" type="button">Print / save PDF</button></div><header><p>${e(r.company || 'SOEICAM')}</p><h1>${e(r.title)}</h1>${r.subtitle?`<p>${e(r.subtitle)}</p>`:''}<dl>${[...(r.metadata||[]),['Currency','XAF'],['Generated',r.generatedAt]].map(([k,v])=>`<div><dt>${e(k)}:</dt><dd>${e(v)}</dd></div>`).join('')}</dl></header>${r.notes?.length?`<div class="notes">${r.notes.map(e).join('<br>')}</div>`:''}${r.sections.map(s=>`<section><h2>${e(s.title||r.title)}</h2><table><thead><tr>${s.columns.map(c=>`<th scope="col">${e(columnLabel(c))}</th>`).join('')}</tr></thead><tbody>${rows(s.rows,s.columns)}${!s.rows.length?`<tr><td colspan="${s.columns.length}">No records</td></tr>`:''}</tbody>${s.totals?.length?`<tfoot>${rows(s.totals,s.columns)}</tfoot>`:''}</table><p>${s.rows.length} records</p></section>`).join('')}<footer>Report snapshot · ${e(r.generatedAt)}</footer></body></html>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc>>>1) ^ (crc&1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function join(parts) { const out = new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let offset=0; for(const p of parts){out.set(p,offset);offset+=p.length;} return out; }
// ZIP STORE keeps this small exporter dependency-free and loads only on demand.
function zip(files) {
  const local=[], central=[]; let offset=0;
  for (const [name, xml] of files) {
    const path=encoder.encode(name), data=encoder.encode(xml), crc=crc32(data);
    const header=new Uint8Array(30), h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,path.length,true);
    local.push(header,path,data);
    const directory=new Uint8Array(46), d=new DataView(directory.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,path.length,true);d.setUint32(42,offset,true);
    central.push(directory,path);offset+=header.length+path.length+data.length;
  }
  const directory=join(central), end=new Uint8Array(22), d=new DataView(end.buffer);
  if (offset+directory.length>0xffffffff || files.length>65535) throw new Error('The workbook is too large. Narrow the report filters.');
  d.setUint32(0,0x06054b50,true);d.setUint16(8,files.length,true);d.setUint16(10,files.length,true);d.setUint32(12,directory.length,true);d.setUint32(16,offset,true);
  return join([...local,directory,end]);
}
function colName(index) { let name=''; for(index++;index;index=Math.floor((index-1)/26)) name=String.fromCharCode(65+(index-1)%26)+name; return name; }
const xmlHead='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const spreadsheetNS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export function reportWorkbook(input) {
  const r=reportSnapshot(input), e=escapeReportText, used=new Set();
  const sheets=r.sections.map((section,i)=>{
    const base=clean(section.title||`Report ${i+1}`).replace(/[\\/?*\[\]:]/g,' ').replace(/^'+|'+$/g,'').trim().slice(0,31)||`Report ${i+1}`;
    let name=base, n=1; while(used.has(name.toLowerCase())) {const suffix=` (${++n})`; name=base.slice(0,31-suffix.length)+suffix;} used.add(name.toLowerCase());
    const prefix=[[r.company||'SOEICAM'],[r.title],...(r.subtitle?[[r.subtitle]]:[]),...(r.metadata||[]).map(([k,v])=>[`${k}: ${v ?? ''}`]),[`Currency: XAF`],[`Generated: ${r.generatedAt}`],...(r.notes||[]).map(note=>[note]),[]];
    const headerRow=prefix.length+1, endRow=headerRow+section.rows.length;
    const all=[...prefix,section.columns.map(columnLabel),...section.rows,...(section.totals||[])];
    if(all.length>1048576) throw new Error('This report exceeds the Excel row limit. Narrow the report filters.');
    const cells=all.map((row,ri)=>`<row r="${ri+1}">${row.map((value,ci)=>{
      if(value==null) return '';
      const numeric=typeof value==='number', style=ri===headerRow-1||ri>=endRow ? 1 : numeric ? (section.columns[ci]?.type==='money'?2:3):0;
      return `<c r="${colName(ci)}${ri+1}" s="${style}"${numeric?'':' t="inlineStr"'}>${numeric?`<v>${value}</v>`:`<is><t xml:space="preserve">${e(value)}</t></is>`}</c>`;
    }).join('')}</row>`).join('');
    const lastCol=colName(section.columns.length-1);
    const xml=xmlHead+`<worksheet xmlns="${spreadsheetNS}"><dimension ref="A1:${lastCol}${all.length}"/><sheetViews><sheetView workbookViewId="0"></sheetView></sheetViews><cols>${section.columns.map((c,ci)=>`<col min="${ci+1}" max="${ci+1}" width="${c?.type==='money'?20:28}" customWidth="1"/>`).join('')}</cols><sheetData>${cells}</sheetData><autoFilter ref="A${headerRow}:${lastCol}${endRow}"/><printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L${e(r.company||'SOEICAM')}&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter></worksheet>`;
    return {name,xml,headerRow};
  });
  const files=[
    ['[Content_Types].xml',xmlHead+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels',xmlHead+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml',xmlHead+`<workbook xmlns="${spreadsheetNS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${e(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><definedNames>${sheets.map((s,i)=>`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${e(s.name.replace(/'/g,"''"))}'!$${s.headerRow}:$${s.headerRow}</definedName>`).join('')}</definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels',xmlHead+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml',xmlHead+`<styleSheet xmlns="${spreadsheetNS}"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;XAF&quot;"/><numFmt numFmtId="165" formatCode="#,##0.##########"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...sheets.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,s.xml]),
  ];
  return zip(files);
}
export function downloadWorkbook(report) {
  const r=reportSnapshot(report), url=URL.createObjectURL(new Blob([reportWorkbook(r)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a');link.href=url;link.download=reportFilename(r,'xlsx');document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function showPrintReport(popup, report) {
  if(!popup || popup.closed) throw new Error('Allow pop-ups to open the printable report.');
  popup.document.open();popup.document.write(reportPrintHtml(report));popup.document.close();
  const print=()=>{popup.focus();popup.print();};
  popup.document.getElementById('report-print')?.addEventListener('click',print);
  popup.requestAnimationFrame(()=>popup.requestAnimationFrame(print));
}
