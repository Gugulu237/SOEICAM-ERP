import {createHash} from 'node:crypto';
import {loadOutletStock} from './outlet-stock.js';
import {businessDate} from '../../lib/business-date.js';
import {round3} from './field-ops.js';

// Outlet reports only: this operation never writes company stock or ledgers.
export async function recordOutletRetailSale(svc,user,employee,body){
  if(!employee || employee.status!=='active' || employee.employee_removed_at)throw Error('An active linked Hotesse account is required');
  if(!/^[a-f0-9-]{36}$/i.test(body.requestKey||''))throw Error('Invalid report reference');
  const quantity=Number(body.quantity);
  if(!['number','string'].includes(typeof body.quantity)||!Number.isFinite(quantity)||quantity<=0||quantity>1e9||round3(quantity)!==quantity)throw Error('Enter a positive sales quantity with at most three decimal places.');
  const id='retail-'+createHash('sha256').update(JSON.stringify([user.id,body.requestKey])).digest('hex').slice(0,40);
  const payload=JSON.stringify([body.locationId,body.productId,quantity,body.snapshotKey]);
  const existing=await svc.entities.OutletVisit.get(id);
  if(existing){if(existing.retail_payload!==payload)throw Error('This save reference was used for different sales details. Reopen the form.');return {report:existing,reused:true};}
  const location=await svc.entities.CustomerLocation.get(body.locationId);
  if(!location || location.is_active===false || !location.assigned_hotesse_ids?.includes(employee.id))throw Error('This active outlet is not assigned to you');
  const customer=await svc.entities.Customer.get(location.customer_id);
  if(!customer || customer.is_active===false || customer.customer_removed_at)throw Error('Choose an active registered customer');
  const date=businessDate(),stock=await loadOutletStock(svc,location,date);
  if(stock.daily_report_submitted)throw Error('Today’s closing report is already submitted.');
  if(!body.snapshotKey || body.snapshotKey!==stock.snapshot_key)throw Error('Outlet stock changed. Close this form, refresh and review the remaining quantity.');
  const product=stock.products.find(p=>p.id===body.productId);
  if(!product || quantity>product.display_quantity || quantity+Number(product.today_sold_quantity||0)>product.opening_quantity)throw Error('Sold units exceed the available outlet stock.');
  const remaining=round3(product.display_quantity-quantity);
  const report=await svc.entities.OutletVisit.create({id,report_sequence:stock.report_sequence+1,retail_payload:payload,request_key:body.requestKey,report_type:'retail_sale',informational_only:true,status:'submitted',
    employee_id:employee.id,employee_name:employee.full_name,recorded_by:user.id,recorded_at:new Date().toISOString(),visit_date:date,
    location_id:location.id,location_name:location.name,customer_id:customer.id,customer_name:customer.business_name,
    lines:[{product_id:product.id,product_name:product.name,image_url:product.image_url||'',unit:product.unit_of_measure||product.storage_unit||'units',
      opening_quantity:product.display_quantity,cumulative_supplied:product.cumulative_supplied,sold_quantity:quantity,damaged_quantity:0,quantity:remaining,expected_closing:remaining,variance:0,issue:'none',availability:remaining===0?'out_of_stock':'available'}],
    has_concerns:remaining===0,notes:'',proof_file_uris:[]});
  return {report};
}
