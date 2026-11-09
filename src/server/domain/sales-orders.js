import {stockStaff,eligibleStockRecipient,STOCK_RECIPIENT_ROLES} from './employee-custody.js';
import {normalizeSaleReplacements,combinedSupplyQuantities,validateReplacementDeclaration} from '../../lib/sale-replacements.js';
import {postSaleReplacements} from './commercial-returns.js';
import {inclusiveSaleLine} from '../../lib/sale-vat.js';
import {createHash} from 'node:crypto';
import {requireStaff,round2,round3,today} from './field-ops.js';
import {readRecords} from './commercial-workspace.js';
import {salesStockSource,salesSourceProducts} from './sales-stock-source.js';
import {invoiceAction} from './sales-invoices.js';
import {invoiceCompany,invoiceDefaults} from '../../lib/invoice-documents.js';
import {finishedProduct,periodDates} from './commercial-rules.js';
import {FACTORY_SALES_LOCATION_TYPES,companySalesWarehouse} from '../../lib/sales-stock.js';
import {stockUnit} from '../../lib/item-units.js';
import {salesDeliveryPoints} from './sales-delivery-points.js';
import {principalRole} from './roles.js';
import {centralizedInventoryPolicy,assertCentralInventory,assertCentralSalesAccess,centralEmployeeCustomers,assertCentralCustomer} from './centralized-inventory-policy.js';

export const SALES_ORDER_ACTIONS=['salesOrderWorkspace','salesOrderDeliveryPoints','salesOrderStock','recordSuppliedOrder'];
const hash=value=>createHash('sha256').update(JSON.stringify(value,(_key,v)=>v && typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
const text=(value,max=1000)=>typeof value==='string'?value.trim().slice(0,max):'';
const saleDate=(value,current=today())=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value>current)throw Error('Choose a valid sale date on or before today.');periodDates(value,value);return value;};
const number=(value,label,max=1e9)=>{if(value==null||value===''||!['number','string'].includes(typeof value)||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>max)throw Error('Enter a valid '+label+'.');return Number(value);};
// Attribution describes who sold the goods, independently of their job or login.
const selectableSeller=staff=>Boolean(staff?.id&&staff.status==='active'&&!staff.employee_removed_at&&principalRole({role:'user'},staff)!=='hotesse');
function selectedSellerId(body,currentSeller,user,canChooseSeller){
  const id=body.sellerId==null||body.sellerId===''||body.sellerId==='user:'+user.id?currentSeller.id:body.sellerId;
  if(typeof id!=='string')throw Error('Choose an active employee as the salesperson.');
  if(id!==currentSeller.id&&!canChooseSeller)throw Error('The salesperson must be your signed-in account. Reload this sale to use the current user.');
  return id;
}
async function resolveSeller(stores,id,currentSeller,currentRole){
  if(id===currentSeller.id)return {id:id.startsWith('user:')?'':id,name:currentSeller.name,role:currentRole};
  const [staff]=await stockStaff(stores,[await stores.Employee.get(id)]);
  if(!selectableSeller(staff))throw Error('Choose an active employee as the salesperson.');
  return {id:staff.id,name:staff.full_name,role:principalRole({role:'user'},staff)};
}
function checkSellerSource(context,id,currentSeller){
  if(id!==currentSeller.id&&context.source_type==='issued'&&context.salesperson_id!==id)throw Error('Choose issued stock assigned to the selected salesperson.');
}
function companySource(body,policy){
  if(!policy)return body;
  if(body.sourceType&&body.sourceType!=='company'||body.dispatchId||body.warehouseId)throw Error('Centralized sales deduct company stock automatically. Do not select an issued load or individual warehouse.');
  return {...body,sourceType:'company'};
}

export async function salesOrderAction(client,user,body,{ownIssuedStock=false}={}){
  const {role,employee}=await requireStaff(client,user,ownIssuedStock?STOCK_RECIPIENT_ROLES:['admin','employee'],'recording customer supplies');
  if(principalRole(user,employee)==='hotesse')throw Object.assign(Error('Hotesses cannot record customer sales.'),{status:403});
  if(role!=='admin'&&employee?.status!=='active')throw Error('An active sales staff account is required.');
  if(ownIssuedStock){if(!eligibleStockRecipient(employee))throw Error('An active employee other than Hotesse is required.');}
  else client.auth.assertModule?.('sales');
  const svc=client.asServiceRole,s=svc.entities,date=today();
  const centralPolicy=await centralizedInventoryPolicy(s);
  const currentSellerId=employee?.id&&employee.status==='active'&&!employee.employee_removed_at?employee.id:'user:'+user.id;
  const currentSeller={id:currentSellerId,name:(currentSellerId===employee?.id?employee.full_name:'')||user.full_name||user.email||'Current user',user_id:user.id};
  const currentSellerRole=principalRole(user,employee),canChooseSeller=Boolean(centralPolicy)||!ownIssuedStock&&currentSellerRole==='admin';
  if(ownIssuedStock&&centralPolicy)await assertCentralSalesAccess(client,user,employee);
  if(ownIssuedStock&&!centralPolicy&&['salesOrderStock','recordSuppliedOrder'].includes(body.action)){
    const run=body.dispatchId?await s.Dispatch.get(body.dispatchId):null;
    if(body.sourceType!=='issued'||!run||run.salesperson_id!==employee.id||body.orderId)throw Error('Use only goods issued to your own employee account.');
  }
  if(body.action==='salesOrderWorkspace'){
    const [runs,warehouses,rawStaff,customers,vehicles]=await Promise.all([
      centralPolicy?[]:readRecords(s.Dispatch,{status:{$in:['loaded','in_transit']},...(ownIssuedStock?{salesperson_id:employee.id}:{})}),readRecords(s.Warehouse),readRecords(s.Employee,{status:'active'}),readRecords(s.Customer,{is_active:true}),centralPolicy?[]:readRecords(s.Vehicle),
    ]);
    const staff=await stockStaff(s,rawStaff);
    const sources=runs.filter(r=>r.vehicle_warehouse_id && !r.return_date && r.dispatch_date<=date && staff.some(e=>e.id===r.salesperson_id&&eligibleStockRecipient(e)) && (!r.driver_id||staff.some(e=>e.id===r.driver_id&&(e.access_template||e.role)==='driver')))
      .map(r=>({id:r.id,dispatch_number:r.dispatch_number,salesperson_id:r.salesperson_id,commercial_name:staff.find(e=>e.id===r.salesperson_id)?.full_name,driver_name:staff.find(e=>e.id===r.driver_id)?.full_name,vehicle_name:r.vehicle_name,vehicle_registration:vehicles.find(v=>v.id===r.vehicle_id)?.registration||'',dispatch_date:r.dispatch_date}));
    const sellers=[currentSeller,...(canChooseSeller?staff.filter(e=>e.id!==currentSellerId&&selectableSeller(e)).map(e=>({id:e.id,name:e.full_name,user_id:e.user_id||''})):[])];
    const visibleCustomers=ownIssuedStock&&centralPolicy?centralEmployeeCustomers(customers,employee,user):customers.filter(c=>!c.customer_removed_at);
    return {sellers,currentSeller,currentSellerId,canChooseSeller,centralized_inventory:centralPolicy||{enabled:false},defaultSource:(centralPolicy||!ownIssuedStock)&&warehouses.some(companySalesWarehouse)?'company':'',runs:sources,warehouses:warehouses.filter(w=>!centralPolicy&&!ownIssuedStock&&w.is_active!==false&&!w.vehicle_id&&FACTORY_SALES_LOCATION_TYPES.includes(w.warehouse_type)).map(w=>({id:w.id,name:w.name})),customers:visibleCustomers.map(c=>({id:c.id,business_name:c.business_name,customer_number:c.customer_number,phone:c.phone,parent_id:c.parent_id,parent_name:c.parent_name,balance:c.balance,credit_limit:c.credit_limit,payment_terms_days:c.payment_terms_days,financial_centralization_mode:c.financial_centralization_mode})),date};
  }
  if(body.action==='salesOrderDeliveryPoints'){
    const customer=typeof body.customerId==='string'?await s.Customer.get(body.customerId):null;
    if(!customer||customer.is_active===false||customer.customer_removed_at)throw Error('Choose an active customer.');
    if(ownIssuedStock&&centralPolicy)await assertCentralCustomer(s,employee,user,customer.id);
    const points=await salesDeliveryPoints(s,customer.id);
    return {points:points.map(p=>({id:p.id,label:p.label,customer_reporting_point:p.customer_reporting_point===true}))};
  }
  if(body.action==='salesOrderStock'){
    const sellerId=selectedSellerId(body,currentSeller,user,canChooseSeller);await resolveSeller(s,sellerId,currentSeller,currentSellerRole);
    const suppliedOn=body.date==null?date:saleDate(body.date,date);
    if(centralPolicy)await assertCentralInventory(s,suppliedOn);
    const context=await salesStockSource(svc,companySource(body,centralPolicy),suppliedOn);
    checkSellerSource(context,sellerId,currentSeller);
    return {source:context,products:await salesSourceProducts(svc,context,suppliedOn)};
  }
  if(body.action!=='recordSuppliedOrder')throw Error('Unknown sales order action.');
  if(!/^[a-f0-9-]{36}$/i.test(body.requestKey||''))throw Error('Reopen this sale for a valid save reference.');
  const sellerId=selectedSellerId(body,currentSeller,user,canChooseSeller);
  const input={orderId:text(body.orderId,100),updatedDate:text(body.updatedDate,100),sourceType:body.sourceType||(centralPolicy?'company':body.sourceType),dispatchId:text(body.dispatchId,100),warehouseId:text(body.warehouseId,100),sellerId,customerId:text(body.customerId,100),locationId:text(body.locationId,100),date:body.date,paymentType:body.paymentType,expectedTotal:body.expectedTotal,notes:text(body.notes,2000),lines:body.lines};
  if(body.stockReplacements!=null)input.stockReplacements=body.stockReplacements;
  if(body.replacementsDeclared!=null)input.replacementsDeclared=body.replacementsDeclared;
  if(body.receiptReference!=null){if(typeof body.receiptReference!=='string'||body.receiptReference.length>200||/[\x00-\x1f\x7f]/.test(body.receiptReference))throw Error('Enter a receipt reference of at most 200 characters.');input.receiptReference=body.receiptReference.trim();}
  const requestId='SSO-'+hash([user.id,body.requestKey]).slice(0,40),payload=hash(input),prior=await s.AuditLog.get(requestId);
  if(prior){
    if(prior.sales_supply_payload!==payload)throw Error('This save reference was already used for different supply details.');
    const order=await s.SalesOrder.get(prior.entity_id);
    if(ownIssuedStock&&centralPolicy&&(!order||order.sales_supply_recorded_by!==user.id))throw Error('You may review only sales recorded under your own profile.');
    return {order,invoiceId:prior.sales_supply_invoice_id,reused:true};
  }
  companySource(input,centralPolicy);
  if(ownIssuedStock&&centralPolicy&&input.orderId)throw Error('Record a new sale under your own profile. Existing sales cannot be reassigned.');
  if(!input.receiptReference)throw Error('Enter the reference number of the receipt issued before recording this sale.');
  const suppliedOn=saleDate(body.date,date);
  if(centralPolicy)await assertCentralInventory(s,suppliedOn);
  const replacements=normalizeSaleReplacements(body.stockReplacements,suppliedOn);
  const replacementError=validateReplacementDeclaration(body.replacementsDeclared,replacements,body.replacementsDeclared!==undefined);
  if(replacementError)throw Error(replacementError);
  const seller=await resolveSeller(s,sellerId,currentSeller,currentSellerRole);
  const exchangeOnly=Array.isArray(body.lines)&&body.lines.length===0&&replacements.length>0;
  if(!exchangeOnly&&!['cash','credit'].includes(body.paymentType))throw Error('Choose cash or credit for this sale.');
  const customer=await s.Customer.get(input.customerId);
  if(!customer||customer.is_active===false||customer.customer_removed_at)throw Error('Choose an active customer.');
  if(ownIssuedStock&&centralPolicy)await assertCentralCustomer(s,employee,user,customer.id);
  const existing=input.orderId?await s.SalesOrder.get(input.orderId):null;
  if(input.orderId&&(!existing||!['draft','confirmed','ready'].includes(existing.status)||existing.sales_supply_recorded_at))throw Error('This order has already been supplied or cannot be edited.');
  if(existing?.updated_date && input.updatedDate!==existing.updated_date)throw Error('This order changed. Reload it before recording the supply.');
  if(existing&&(await readRecords(s.StockMovement,{document_id:existing.id,status:'approved'})).some(m=>Number(m.quantity)>0&&m.source_warehouse_id&&!m.destination_warehouse_id))throw Error('This order already has goods issued. Reconcile its existing delivery before recording it.');
  if(!Array.isArray(body.lines)||!body.lines.length&&!exchangeOnly||body.lines.length>50||new Set(body.lines.map(l=>l?.product_id)).size!==body.lines.length)throw Error('Enter 1 to 50 distinct finished products.');
  const context=await salesStockSource(svc,input,suppliedOn);
  checkSellerSource(context,sellerId,currentSeller);
  const products=await salesSourceProducts(svc,context,suppliedOn);
  const lines=body.lines.map(row=>{
    const p=products.find(p=>p.id===row?.product_id);
    if(!p||!finishedProduct(p))throw Error('Choose finished products available at the selected stock source.');
    const quantity=number(row.quantity,'quantity'),price=number(row.unit_price,'unit price'),discountPct=number(row.discount_pct??0,'discount',100),taxRate=number(p.tax_rate??0,'tax rate',100);
    if(quantity<=0||round3(quantity)!==quantity||quantity>p.available)throw Error('Review the supplied quantity for '+p.name+'.');
    if(price!==round2(price))throw Error('Use unit prices with at most two decimal places.');
    const amounts=inclusiveSaleLine(quantity,price,taxRate,discountPct);
    return {product_id:p.id,product_name:p.name,unit:p.unit||stockUnit(p),quantity,unit_price:price,price_includes_vat:true,discount_pct:discountPct,discount_amount:amounts.discount,tax_rate:taxRate,tax_amount:amounts.tax,total:amounts.total};
  });
  const combined=combinedSupplyQuantities(lines,replacements);
  if(combined.length>50||combined.some(line=>line.quantity>Number(products.find(p=>p.id===line.product_id)?.available||0)))throw Error('Sold units and free replacements exceed the available delivery stock.');
  const subtotal=round2(lines.reduce((n,l)=>n+l.total-l.tax_amount,0)),tax=round2(lines.reduce((n,l)=>n+l.tax_amount,0)),total=round2(subtotal+tax);
  if(!exchangeOnly&&total<=0||total>1e12)throw Error('Enter a positive sale total.');
  if(number(body.expectedTotal,'sale total',1e12)!==total)throw Error('The sale total changed. Refresh stock and review the quantities, prices and tax before recording.');
  const customerBalance=Number(customer.balance??0),creditLimit=number(customer.credit_limit??0,'customer credit limit',1e12);
  if(!Number.isFinite(customerBalance)||Math.abs(customerBalance)>1e12)throw Error('Reconcile this customer balance before recording a supply.');
  if(!exchangeOnly&&body.paymentType==='credit'&&creditLimit>0&&round2(customerBalance+total)>creditLimit)throw Error('This supply exceeds the customer credit limit.');
  const points=await salesDeliveryPoints(s,customer.id);
  const point=input.locationId?points.find(p=>p.id===input.locationId):points.length===1?points[0]:null;
  if(input.locationId&&!point)throw Error('Choose a delivery point belonging to this customer.');
  if(points.length>1&&!point)throw Error('Choose the customer branch that received this supply.');
  const terms=number(customer.payment_terms_days??0,'payment terms',3650);if(!Number.isInteger(terms))throw Error('Enter whole days for the customer payment terms.');
  const now=new Date().toISOString();
  const values={supply_kind:exchangeOnly?'exchange':replacements.length?'sale_exchange':'sale',stock_replacements:replacements.map(row=>({...row,product_name:products.find(p=>p.id===row.product_id)?.name,unit:products.find(p=>p.id===row.product_id)?.unit})),stock_replacements_declared:body.replacementsDeclared??replacements.length>0,price_includes_vat:true,customer_id:customer.id,customer_name:customer.business_name,location_id:point?.id||'',location_name:point?.name||'',warehouse_id:context.stock_warehouse_id,warehouse_name:context.stock_warehouse_name,dispatch_id:context.dispatch_id,vehicle_id:context.vehicle_id,vehicle_name:context.vehicle_name,driver_id:context.driver_id,driver_name:context.driver_name,salesperson_id:seller.id,salesperson_name:seller.name,route_id:context.route_id,order_date:suppliedOn,delivery_date:suppliedOn,payment_type:exchangeOnly?'exchange':body.paymentType,payment_terms_days:exchangeOnly?0:terms,notes:input.notes,receipt_reference:input.receiptReference,subtotal,discount_total:round2(lines.reduce((n,l)=>n+l.discount_amount,0)),tax_total:tax,total,status:'draft',sales_supply_source:context.source_type,sales_supply_seller_id:input.sellerId,sales_supply_seller_role:seller.role,sales_supply_stockholder_id:context.salesperson_id||'',sales_supply_stockholder_name:context.salesperson_name||'',sales_supply_recorded_by:user.id,sales_supply_recorded_at:now,sales_supply_request_id:requestId};
  if(centralPolicy)Object.assign(values,{sales_supply_centralized_inventory:{policy:centralPolicy.policy,activation_id:centralPolicy.activation_id,effective_date:centralPolicy.effective_date,employee_id:seller.id,recorded_by:user.id}});
  Object.assign(values,{sales_supply_acquisition_agent_id:customer.acquired_by_id||customer.registered_employee_id||'',sales_supply_registration_user_id:customer.registered_by_id||''});
  const order=existing?await s.SalesOrder.update(existing.id,values):await s.SalesOrder.create({...values,order_number:'SO-'+crypto.randomUUID().slice(0,12).toUpperCase(),created_by:user.id});
  if(existing)await s.SalesOrderLine.deleteMany({order_id:order.id});
  await s.SalesOrderLine.bulkCreate(lines.map(l=>({...l,order_id:order.id,sales_supply_order_id:order.id})));
  const due=new Date(Date.parse(suppliedOn+'T00:00:00Z')+(body.paymentType==='credit'?terms:0)*86400000).toISOString().slice(0,10);
  const company=invoiceCompany((await readRecords(s.CompanySettings))[0]);
  const result=exchangeOnly?null:await invoiceAction(client,user,{action:'createSalesInvoice',sourceType:'order',sourceId:order.id,invoiceDate:suppliedOn,dueDate:due,options:{...invoiceDefaults(customer,company),reference:input.receiptReference}},{ownIssuedStock});
  await postSaleReplacements(svc,user,{...order,...context,id:order.id,source_order_id:order.id,sale_number:order.order_number,transaction_date:suppliedOn,commercial_id:context.salesperson_id||seller.id,commercial_name:context.salesperson_name||seller.name,recorded_by:user.id},replacements,context);
  if(exchangeOnly)await s.SalesOrder.update(order.id,{status:'delivered',amount_collected:0,amount_due:0,exchange_completed_at:now});
  const posted=await s.SalesOrder.get(order.id);
  await s.AuditLog.create({id:requestId,action:'record_supplied_order',module:'sales_supply',entity_type:'SalesOrder',entity_id:order.id,user_id:user.id,user_name:employee?.full_name||user.full_name||user.email,audit_source:'server_verified',sales_supply_payload:payload,sales_supply_invoice_id:result?.invoice.id||'',sales_supply_seller_id:sellerId,sales_supply_seller_name:seller.name,sales_supply_seller_role:seller.role,sales_supply_recorded_by:user.id,sales_supply_on_behalf:sellerId!==currentSellerId,description:'Recorded supplied order '+order.order_number});
  return {order:posted,invoiceId:result?.invoice.id||'',exchangeOnly};
}
