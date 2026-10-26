export const isOpeningRecord=row=>Boolean(row?.opening_batch_id||row?.accounting_source==='opening_balances');
export const openingPartyLines=line=>Array.isArray(line?.opening_party_allocations)?line.opening_party_allocations.map(row=>({...line,...row,opening_party_allocations:undefined})):[line];
