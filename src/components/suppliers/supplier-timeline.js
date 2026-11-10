// Read-only document activity. Each payment appears once; advances are not
// treated as an additional balance or an inferred amount available to allocate.
export function supplierTimelineEntries({bills=[],payments=[],orders=[]}={}) {
  const orderNumbers=new Map(orders.map(order=>[order.id,order.po_number]));
  const billNumbers=new Map(bills.map(bill=>[bill.id,bill.bill_number]));
  return [
    ...bills.map(record=>({
      id:'bill:'+record.id,kind:'bill',date:record.bill_date||'',record,
      reference:record.bill_number,
      relatedReference:record.po_number||orderNumbers.get(record.po_id)||'',
      outstanding:!['draft','cancelled'].includes(record.status)&&Number(record.balance)>0,
    })),
    ...payments.map(record=>({
      id:'payment:'+record.id,
      kind:record.status==='posted'&&record.po_id&&!record.bill_id?'advance':'payment',
      date:record.payment_date||'',record,reference:record.payment_number,
      relatedReference:billNumbers.get(record.bill_id)||orderNumbers.get(record.po_id)||'',
    })),
  ].sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
}
