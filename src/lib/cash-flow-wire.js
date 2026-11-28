// The same posted entry can appear in a bucket, a subtotal, a balance and
// both comparative columns. Send each distinct trace once, without rounding
// or collapsing signed entries, including same-journal compound allocations.
const traceKeys=new Set(['traces','openingTraces','closingTraces','correctionTraces','transferTraces']);
function transform(value, convert) {
  if (Array.isArray(value)) return value.map(item=>transform(item,convert));
  if (!value || typeof value!=='object') return value;
  return Object.fromEntries(Object.entries(value).map(([key,child])=>[
    key,traceKeys.has(key)&&Array.isArray(child)?child.map(convert):transform(child,convert),
  ]));
}
export function packCashFlowReport(report) {
  const indices=new Map(), traces=[];
  const data=transform(report, trace=>{
    const key=JSON.stringify(trace);
    if (!indices.has(key)) {indices.set(key,traces.length);traces.push(trace);}
    return indices.get(key);
  });
  return {encoding:'cash-flow/1',traces,data};
}
export function unpackCashFlowReport(wire) {
  if (!wire?.encoding) return wire;
  if (wire.encoding!=='cash-flow/1'||!Array.isArray(wire.traces)||!wire.data) throw Error('Unsupported cash-flow report format.');
  return transform(wire.data,i=>{
    if (!Number.isInteger(i)||i<0||i>=wire.traces.length) throw Error('Cash-flow trace is missing. Reload the report.');
    return wire.traces[i];
  });
}
