// Read-only product attribution for the already authorized, journal-verified
// company sales register. Never allocate an unexplained document difference to a
// product, infer a unit conversion, or treat a stock replacement as revenue.
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
const text=value=>typeof value==='string'?value:'';
const identity=value=>text(value).trim()?text(value):'';
const present=value=>value!==null&&value!==undefined&&value!=='';
function minor(value,scale,label,{optional=false}={}){
 if(optional&&!present(value))return 0;
 if(!['number','string'].includes(typeof value)||typeof value==='string'&&!value.trim())throw Error(label);
 const number=Number(value),integer=Math.round(number*scale);
 if(!Number.isFinite(number)||number<0||!Number.isSafeInteger(integer)||Math.abs(number*scale-integer)>0.00001)throw Error(label);
 return BigInt(integer);
}
function signedMinor(value,scale,label){
 if(!['number','string'].includes(typeof value)||typeof value==='string'&&!value.trim())throw Error(label);
 const number=Number(value),integer=Math.round(number*scale);
 if(!Number.isFinite(number)||!Number.isSafeInteger(integer)||Math.abs(number*scale-integer)>0.00001)throw Error(label);
 return BigInt(integer);
}
function number(value,scale){if(value>MAX||value< -MAX)throw Error('Product report totals exceed the supported precision.');return Number(value)/scale||0;}
const money=value=>number(value,100);
const quantity=value=>number(value,1000);
const add=(target,key,value)=>{target[key]=(target[key]||0n)+value;};
const roundedProduct=(price,units)=>(price*units+500n)/1000n;
const sortText=(a,b)=>String(a).localeCompare(String(b));
function inclusivePolicy(line,header){
 const own=typeof line.price_includes_vat==='boolean'?line.price_includes_vat:null;
 const source=typeof header?.price_includes_vat==='boolean'?header.price_includes_vat:null;
 return own!==null&&source!==null&&own!==source?null:own??source;
}
function discountFor(line,header,kind,units,net,tax,total){
 const policy=inclusivePolicy(line,header),basis=policy===true?'including_tax':policy===false?'excluding_tax':'unknown';
 const saved=kind==='Commercial supply'?(present(line.discount)?line.discount:line.discount_amount):line.discount_amount;
 if(present(saved)){
  try{return {value:minor(saved,100,'Recorded discount is invalid.'),basis};}
  catch{return {value:null,basis,reason:'Recorded discount is invalid.'};}
 }
 // FieldSale.discount is a monetary reduction from the saved list price, not
 // a percentage. That reduction may already be included in saved unit_price.
 if(kind==='Commercial supply'&&present(line.list_price)&&present(line.unit_price)){
  try{const list=minor(line.list_price,100,'Saved price is invalid.'),charged=minor(line.unit_price,100,'Saved price is invalid.');return {value:roundedProduct(list>charged?list-charged:0n,units),basis};}
  catch{return {value:null,basis,reason:'Saved discount price evidence is invalid.'};}
 }
 if(!present(line.unit_price)||policy===null&&tax!==0n)return {value:null,basis,reason:'Recorded discount evidence is unavailable.'};
 try{
  const gross=roundedProduct(minor(line.unit_price,100,'Saved price is invalid.'),units),charged=policy===true?total:net,discount=gross-charged;
  if(discount<0n||discount>MAX)throw Error('Invalid saved discount.');
  return {value:discount,basis};
 }catch{return {value:null,basis,reason:'Saved discount price evidence is invalid.'};}
}
function exactHeader(row){
 const net=signedMinor(row.subtotal,100,'Document net revenue is invalid.'),tax=signedMinor(row.tax,100,'Document tax is invalid.'),total=signedMinor(row.total,100,'Document total is invalid.');
 if(net+tax!==total)throw Error('Document revenue and tax do not reconcile.');
 const sign=row.is_reversal===true?-1n:1n;
 if(net*sign<0n||tax*sign<0n||total*sign<0n)throw Error('Document amounts do not match the recorded reversal direction.');
 return {net,tax,total,sign};
}
function lineValues(line,kind,header){
 const units=minor(line.quantity,1000,'Product quantity is invalid.');if(units===0n)throw Error('Product quantity must be positive.');
 const tax=minor(line.tax_amount,100,'Product tax is invalid.',{optional:true});
 const net=kind==='Commercial supply'?minor(line.line_total,100,'Product net revenue is invalid.'):minor(line.total,100,'Product total is invalid.')-tax;
 const total=kind==='Commercial supply'?net+tax:minor(line.total,100,'Product total is invalid.');
 if(net<0n||total>MAX)throw Error('Product revenue and tax are invalid.');
 return {units,net,tax,total,discount:discountFor(line,header,kind,units,net,tax,total)};
}
function publicTransaction(row,line,values,groupKey,index){
 const sign=row.is_reversal===true?-1n:1n;
 const out={id:row.id+':'+(text(line.id)||'line-'+index),row_id:row.id,line_id:text(line.id),group_key:groupKey,product_id:identity(line.product_id),product_name:text(line.product_name),unit:identity(line.unit),quantity:quantity(values.units*sign),discount:values.discount.value===null?null:money(values.discount.value*sign),discount_complete:values.discount.value!==null,discount_basis:values.discount.basis,net_revenue:money(values.net*sign),tax:money(values.tax*sign),total_revenue:money(values.total*sign),subtotal:money(values.net*sign),total:money(values.total*sign),is_reversal:row.is_reversal===true};
 for(const key of ['source','document_id','document_number','date','original_date','receipt_reference','customer_id','customer_name','commercial_id','commercial_name','journal_id','journal_number','original_journal_id','original_journal_number','vat_correction_journal_id','vat_correction_journal_number','invoice_id','sales_order_id','payment_type','status'])if(text(row[key]))out[key]=row[key];
 return out;
}
function publicAmounts(value){return {discount:value.unknown_discount_count?null:money(value.discount||0n),discount_complete:!value.unknown_discount_count,unknown_discount_count:value.unknown_discount_count||0,net_revenue:money(value.net_revenue||0n),tax:money(value.tax||0n),total_revenue:money(value.total_revenue||0n)};}

export function buildProductSalesReport({rows=[],invoiceLines=[],fieldLines=[],invoices=[],fieldSales=[],products=[]}={}){
 const invoiceHeaders=new Map(invoices.map(row=>[row.id,row])),fieldHeaders=new Map(fieldSales.map(row=>[row.id,row])),productMap=new Map(products.map(row=>[row.id,row]));
 const indexed=new Map();
 for(const [kind,lines,key] of [['Invoice',invoiceLines,'invoice_id'],['Commercial supply',fieldLines,'field_sale_id']])for(const line of lines){const id=kind+':'+line[key];if(!indexed.has(id))indexed.set(id,[]);indexed.get(id).push(line);}
 const issues=[],transactions=[],groups=new Map(),totals={discount:0n,net_revenue:0n,tax:0n,total_revenue:0n,unknown_discount_count:0};
 const included=new Set(),excluded=new Set(),expected={net:0n,tax:0n,total:0n},rowIds=new Set(),postingRows=new Map();let validExpected=true,currentIndex=-1;
 const issue=(row,code,reason,blocking=true,line)=>{issues.push({code,reason,row_id:text(row.id),document_id:text(row.document_id),document_number:text(row.document_number),...(text(line?.id)?{line_id:line.id}:{}),blocking});if(blocking)excluded.add(currentIndex);};
 // Defensive de-duplication. The normal caller has already removed linked
 // invoices; if both are supplied, the original Commercial supply is preferred.
 const preferred=new Map();
 for(const row of rows){if(!row.journal_id)continue;const previous=preferred.get(row.journal_id);if(!previous||row.source==='Commercial supply'&&previous.source!=='Commercial supply')preferred.set(row.journal_id,row);}
 for(const [rowIndex,row] of rows.entries()){
  currentIndex=rowIndex;
  let header;
  try{header=exactHeader(row);expected.net+=header.net;expected.tax+=header.tax;expected.total+=header.total;}catch(error){validExpected=false;issue(row,'invalid_document',error.message);continue;}
  if(!identity(row.id)||!identity(row.document_id)||!identity(row.journal_id)||!['Invoice','Commercial supply'].includes(row.source)){issue(row,'missing_proof','Document source or journal proof is unavailable.');continue;}
  if(rowIds.has(row.id)){issue(row,'duplicate_row','The same register transaction was supplied more than once.');continue;}rowIds.add(row.id);
  if(preferred.get(row.journal_id)!==row||postingRows.has(row.journal_id)){issue(row,'duplicate_posting','A linked invoice or repeated journal is excluded to avoid counting the same sale twice.');continue;}postingRows.set(row.journal_id,row.id);
  const sourceHeader=(row.source==='Invoice'?invoiceHeaders:fieldHeaders).get(row.document_id)||row;
  const lines=indexed.get(row.source+':'+row.document_id)||[];
  if(!lines.length){issue(row,'missing_lines','Saved product lines are unavailable for this document.');continue;}
  const lineIds=new Set(),prepared=[];let sumNet=0n,sumTax=0n,sumTotal=0n;
  try{
   for(let i=0;i<lines.length;i++){
    const line=lines[i];if(line.id&&lineIds.has(line.id))throw Error('Saved product lines contain a duplicate line.');if(line.id)lineIds.add(line.id);
    if(header.tax!==0n&&!present(line.tax_amount))throw Error('Saved line tax is unavailable for a taxable document.');
    const values=lineValues(line,row.source,sourceHeader);sumNet+=values.net;sumTax+=values.tax;sumTotal+=values.total;prepared.push({line,values,index:i});
   }
   if(sumNet*header.sign!==header.net||sumTax*header.sign!==header.tax||sumTotal*header.sign!==header.total)throw Error('Saved product lines do not reconcile to the document revenue and tax.');
  }catch(error){issue(row,'line_reconciliation',error.message);continue;}
  if(present(sourceHeader.discount_total)){
   try{
    const savedDiscount=minor(sourceHeader.discount_total,100,'Saved document discount is invalid.');
    if(prepared.every(item=>item.values.discount.value!==null)&&prepared.reduce((sum,item)=>sum+item.values.discount.value,0n)!==savedDiscount)throw Error('Saved line discounts do not reconcile to the document discount.');
   }catch(error){for(const item of prepared)item.values.discount={...item.values.discount,value:null,reason:error.message};}
  }
  included.add(rowIndex);
  for(const {line,values,index} of prepared){
   const productId=identity(line.product_id),unit=identity(line.unit),fallback=row.source+':'+row.document_id+':'+(text(line.id)||index);
   const groupKey=JSON.stringify([productId||'historical:'+fallback,unit||'unknown-unit:'+fallback]);
   const product=productMap.get(productId),tx=publicTransaction(row,line,values,groupKey,index);if(!tx.product_name)tx.product_name=text(product?.name)||'Unidentified product';transactions.push(tx);
   let group=groups.get(groupKey);
   if(!group){group={key:groupKey,product_id:productId,product_name:text(product?.name)||text(line.product_name)||'Unidentified product',image_url:text(line.image_url)||text(line.product_image_url)||text(product?.image_url),unit,unit_unknown:!unit,identity_unknown:!productId,sold_quantity:0n,reversed_quantity:0n,net_quantity:0n,discount:0n,net_revenue:0n,tax:0n,total_revenue:0n,sold_total_revenue:0n,reversed_total_revenue:0n,unknown_discount_count:0,bases:new Set(),transactions:new Set(),sales:new Set(),reversals:new Set(),transaction_ids:[]};groups.set(groupKey,group);}
   const reversal=row.is_reversal===true,sign=reversal?-1n:1n;
   add(group,reversal?'reversed_quantity':'sold_quantity',values.units);add(group,'net_quantity',values.units*sign);add(group,reversal?'reversed_total_revenue':'sold_total_revenue',values.total);
   for(const [key,value] of [['net_revenue',values.net],['tax',values.tax],['total_revenue',values.total]]){add(group,key,value*sign);add(totals,key,value*sign);}
   group.bases.add(values.discount.basis);group.transactions.add(row.id);group[reversal?'reversals':'sales'].add(row.id);group.transaction_ids.push(tx.id);
   if(values.discount.value===null){group.unknown_discount_count++;totals.unknown_discount_count++;issue(row,'unknown_discount',values.discount.reason||'Recorded discount evidence is unavailable.',false,line);}
   else{add(group,'discount',values.discount.value*sign);add(totals,'discount',values.discount.value*sign);}
  }
 }
 const ranking=[...groups.values()].sort((a,b)=>sortText(a.unit,b.unit)||(a.net_quantity>b.net_quantity?-1:a.net_quantity<b.net_quantity?1:0)||(a.total_revenue>b.total_revenue?-1:a.total_revenue<b.total_revenue?1:0)||sortText(a.product_name,b.product_name)||sortText(a.key,b.key));
 const ranks=new Map(),unitGroups=new Map();
 const resultProducts=ranking.map(group=>{
  const eligible=!!group.unit&&!!group.product_id,rank=eligible?(ranks.get(group.unit)||0)+1:null;if(eligible)ranks.set(group.unit,rank);
  if(group.unit){let unit=unitGroups.get(group.unit);if(!unit){unit={unit:group.unit,sold_quantity:0n,reversed_quantity:0n,net_quantity:0n};unitGroups.set(group.unit,unit);}for(const key of ['sold_quantity','reversed_quantity','net_quantity'])add(unit,key,group[key]);}
  return {key:group.key,product_id:group.product_id,product_name:group.product_name,image_url:group.image_url,unit:group.unit,unit_unknown:group.unit_unknown,identity_unknown:group.identity_unknown,rank,rank_unit:rank?group.unit:'',sold_quantity:quantity(group.sold_quantity),reversed_quantity:quantity(group.reversed_quantity),net_quantity:quantity(group.net_quantity),...publicAmounts(group),discount_basis:group.bases.size>1?'mixed':[...group.bases][0]||'unknown',sold_total_revenue:money(group.sold_total_revenue),reversed_total_revenue:money(group.reversed_total_revenue),transaction_count:group.transactions.size,sale_count:group.sales.size,reversal_count:group.reversals.size,transaction_ids:group.transaction_ids};
 });
 const mapped=publicAmounts(totals),expectedRevenue=validExpected?money(expected.total):null;
 return {products:resultProducts,transactions,totals:mapped,unit_totals:[...unitGroups.values()].sort((a,b)=>sortText(a.unit,b.unit)).map(unit=>({unit:unit.unit,sold_quantity:quantity(unit.sold_quantity),reversed_quantity:quantity(unit.reversed_quantity),net_quantity:quantity(unit.net_quantity)})),coverage:{document_count:rows.length,included_documents:included.size,excluded_documents:excluded.size,complete:excluded.size===0,discount_complete:mapped.discount_complete,unknown_discount_count:totals.unknown_discount_count,expected_total_revenue:expectedRevenue,mapped_total_revenue:mapped.total_revenue,difference_total_revenue:expectedRevenue===null?null:money(expected.total-totals.total_revenue),unranked_product_groups:resultProducts.filter(group=>group.rank===null).length},issues};
}

// Sorting by demand is meaningful only within the exact recorded unit. Revenue
// may be compared across units because all amounts are XAF; no quantities sum.
export function rankProductSales(products,{metric='quantity',unit}={}){
 const rows=products.filter(product=>unit===undefined||product.unit===unit);
 return [...rows].sort((a,b)=>metric==='revenue'?b.net_revenue-a.net_revenue||sortText(a.product_name,b.product_name):sortText(a.unit,b.unit)||b.net_quantity-a.net_quantity||sortText(a.product_name,b.product_name));
}
