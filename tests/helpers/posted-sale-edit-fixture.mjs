import {businessDate} from '../../src/lib/business-date.js';
import {splitIncludedVat} from '../../src/lib/sale-vat.js';
export function postedSaleFixture({cash=false,userId='gm',role='admin'}={}){
 const date=businessDate(),vat=splitIncludedVat(2000,19.25),account=(id,type,normal,balance,account_number=id)=>({id,name:id,account_type:type,normal_balance:normal,balance,account_number,is_active:true,is_posting:true,currency:'XAF'});
 const rows={
  Employee:[{id:'staff',user_id:userId,role,status:'active',full_name:'Recorder'}],
  Customer:[{id:'c1',business_name:'Customer A',balance:cash?0:2000,is_active:true,financial_centralization_mode:'centralized'},{id:'c2',business_name:'Customer B',balance:50,is_active:true}],
  CustomerLocation:[],Warehouse:[{id:'factory',name:'Cold room',warehouse_type:'cold_room',is_active:true}],
  Product:[{id:'p1',name:'YOLA',inventory_type:'assembly',is_active:true,unit_of_measure:'ea',inventory_account_id:'inventory',cogs_account_id:'cogs',revenue_account_id:'revenue'}],
  StockBalance:[{id:'stock',product_id:'p1',product_name:'YOLA',warehouse_id:'factory',quantity:6,total_value:1200,unit_cost:200,lot_number:'LOT-1',production_order_id:'batch-1',expiry_date:'2099-01-01',qc_status:'approved'}],
  StockMovement:[{id:'issue',product_id:'p1',product_name:'YOLA',document_type:'SalesOrder',document_id:'order',status:'approved',movement_type:'customer_delivery',source_warehouse_id:'factory',lot_number:'LOT-1',production_order_id:'batch-1',expiry_date:'2099-01-01',quantity:4,total_value:800,unit_cost:200,movement_date:date}],
  Account:[account('cash','asset','debit',cash?102000:100000,'1010'),account('ar','asset','debit',cash?0:2000,'1200'),account('inventory','asset','debit',1200,'1320'),account('cogs','cogs','debit',800,'5100'),account('revenue','revenue','credit',vat.net,'4100'),account('tax','liability','credit',vat.tax,'4300'),account('clearing','asset','debit',0,'1050')],
  PostingRule:[['customer_receivable','ar'],['finished_goods_inventory','inventory'],['direct_material_cogs','cogs'],['sales_revenue','revenue'],['tax_payable','tax']].map(([rule_key,account_id])=>({id:rule_key,rule_key,account_id,is_active:true})),
  AccountingPeriod:[{id:'period',start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31',status:'open'}],
  TreasuryAccount:[{id:'till',name:'Main cash',account_type:'cash',gl_account_id:'cash',balance:cash?102000:100000,is_active:true}],
  TreasuryTransaction:cash?[{id:'cash-receipt',source:'cash_sale',source_document_id:'invoice',treasury_account_id:'till',transaction_type:'receipt',journal_id:'journal',amount:2000,transaction_date:date}]:[],
  Invoice:[{id:'invoice',invoice_number:'INV-TEST',sales_order_id:'order',customer_id:'c1',customer_name:'Customer A',location_id:'',invoice_date:date,due_date:date,payment_type:cash?'cash':'credit',status:cash?'paid':'posted',price_includes_vat:true,subtotal:vat.net,tax_total:vat.tax,total:2000,amount_paid:cash?2000:0,balance:cash?0:2000,journal_id:'journal',recorded_by:'gm',document_revision:1,receipt_reference:'R-1',invoice_document:{company:{company_name:'SOEICAM'},options:{reference:'R-1'}},...(cash?{cash_deposited:true,deposit_journal_id:'journal',deposit_treasury_account_id:'till',cash_sale_settlement:{treasury_account_id:'till',ledger_account_id:'cash',transaction_id:'cash-receipt',journal_id:'journal',amount:2000}}:{})}],
  InvoiceLine:[{id:'invoice-line',invoice_id:'invoice',product_id:'p1',product_name:'YOLA',quantity:4,unit:'ea',unit_price:500,total:2000,tax_amount:vat.tax,tax_rate:19.25,discount_amount:0,cogs_total:800,unit_cost:200,price_includes_vat:true}],
  SalesOrder:[{id:'order',order_number:'SO-TEST',customer_id:'c1',customer_name:'Customer A',location_id:'',status:'invoiced',payment_type:cash?'cash':'credit',price_includes_vat:true,subtotal:vat.net,tax_total:vat.tax,total:2000,order_date:date,invoice_id:'invoice',warehouse_id:'factory',sales_supply_source:'warehouse',sales_supply_recorded_by:'gm',amount_collected:cash?2000:0,amount_due:cash?0:2000,receipt_reference:'R-1'}],
  SalesOrderLine:[{id:'order-line',order_id:'order',product_id:'p1',product_name:'YOLA',quantity:4,unit:'ea',unit_price:500,total:2000,tax_amount:vat.tax,tax_rate:19.25,discount_amount:0,unit_cost:200}],
  JournalEntry:[{id:'journal',journal_number:'JV-TEST',entry_date:date,status:'posted',source_module:'sales',source_document_type:'Invoice',source_document_id:'invoice',description:'Invoice INV-TEST — Customer A',total_debit:2800,total_credit:2800,is_immutable:true}],
  JournalLine:[{id:'debit',journal_id:'journal',account_id:cash?'cash':'ar',debit:2000,credit:0,party_type:'customer',party_id:'c1',description:'Invoice INV-TEST — Customer A',status:'posted'},{id:'revenue-line',journal_id:'journal',account_id:'revenue',debit:0,credit:vat.net,description:'Sales revenue',status:'posted'},{id:'tax-line',journal_id:'journal',account_id:'tax',debit:0,credit:vat.tax,status:'posted'},{id:'cogs-line',journal_id:'journal',account_id:'cogs',debit:800,credit:0,description:'Cost of goods sold',status:'posted'},{id:'inventory-line',journal_id:'journal',account_id:'inventory',debit:0,credit:800,description:'Inventory released',status:'posted'}],
  Payment:[],PaymentAllocation:[],CashCollection:[],FieldSale:[],FieldSaleLine:[],AuditLog:[],CompanySettings:[{id:'settings'}]
 };
 let serial=0;
 const matches=(r,q={})=>Object.entries(q).every(([k,v])=>k==='$or'?v.some(x=>matches(r,x)):v&&typeof v==='object'?Object.entries(v).every(([op,x])=>op==='$in'?x.includes(r[k]):op==='$ne'?r[k]!==x:op==='$gte'?r[k]>=x:op==='$lte'?r[k]<=x:op==='$gt'?r[k]>x:false):r[k]===v);
 const stores=Object.fromEntries(Object.keys(rows).map(name=>[name,{
  list:async()=>structuredClone(rows[name]),get:async id=>structuredClone(rows[name].find(r=>r.id===id)),
  filter:async(q,_sort,limit,skip=0)=>structuredClone(rows[name].filter(r=>matches(r,q)).slice(skip,typeof limit==='number'?skip+limit:undefined)),
  create:async value=>{const row={...structuredClone(value),id:value.id||name+'-'+(++serial)};rows[name].push(row);return structuredClone(row);},
  update:async(id,value)=>{const row=rows[name].find(r=>r.id===id);if(!row)throw Error(name+' missing: '+id);Object.assign(row,structuredClone(value));return structuredClone(row);},
  delete:async id=>{rows[name]=rows[name].filter(r=>r.id!==id);},
  bulkCreate:async values=>{const result=[];for(const v of values)result.push(await stores[name].create(v));return result;}
 }]));
 const user={id:userId,role:role==='admin'?'admin':'user',full_name:'Recorder'},client={auth:{me:async()=>user,staff:async()=>stores.Employee.get('staff'),assertModule:()=>{}},asServiceRole:{entities:stores}};
 return {rows,stores,user,client,date};
}

export function postedFieldFixture({cash=false,invoiced=true}={}){
 const f=postedSaleFixture({cash}),invoice=f.rows.Invoice[0],line=f.rows.InvoiceLine[0];
 const sale={id:'field',sale_number:'FS-TEST',commercial_id:'staff',commercial_name:'Recorder',customer_id:'c1',customer_name:'Customer A',transaction_date:f.date,status:'approved_posted',payment_type:cash?'cash':'credit',price_includes_vat:true,subtotal:invoice.subtotal,tax_total:invoice.tax_total,total:2000,amount_collected:cash?2000:0,amount_due:cash?0:2000,journal_id:'journal',receipt_reference:'R-1',recorded_by:'gm'};
 f.rows.FieldSale=[sale];f.rows.FieldSaleLine=[{id:'field-line',field_sale_id:'field',product_id:'p1',product_name:'YOLA',quantity:4,unit:'ea',unit_price:500,line_total:line.total-line.tax_amount,tax_amount:line.tax_amount,tax_rate:19.25,line_cost:800,unit_cost:200,price_includes_vat:true}];
 f.rows.StockMovement[0].document_type='FieldSale';f.rows.StockMovement[0].document_id='field';
 f.rows.JournalEntry[0].source_document_type='FieldSale';f.rows.JournalEntry[0].source_document_id='field';
 invoice.field_sale_id='field';delete invoice.sales_order_id;delete invoice.cash_sale_settlement;
 f.rows.SalesOrder=[];f.rows.SalesOrderLine=[];
 if(cash){f.rows.TreasuryTransaction=[];f.rows.TreasuryAccount[0].balance=100000;f.rows.Account.find(a=>a.id==='cash').balance=100000;f.rows.Account.find(a=>a.id==='clearing').balance=2000;f.rows.JournalLine[0].account_id='clearing';f.rows.CashCollection=[{id:'collection',field_sale_id:'field',amount_collected:2000,outstanding_amount:2000,received_amount:0,handed_over_amount:0,status:'held_by_commercial'}];}
 if(!invoiced){f.rows.Invoice=[];f.rows.InvoiceLine=[];}
 return f;
}
