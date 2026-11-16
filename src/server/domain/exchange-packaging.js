import {createHash} from 'node:crypto';
import {readRecords} from './commercial-workspace.js';
import {itemUnitCost,stockUnit,unitFactor} from '../../lib/item-units.js';
import {exchangePackagingEnabled} from '../../lib/exchange-packaging.js';
import {validPostingRuleAccount} from '../../lib/posting-rule-types.js';

const key=id=>'EPR-'+createHash('sha256').update(id).digest('hex').slice(0,40);
const issue=message=>Object.assign(Error(message),{exchangeMappingIssue:true});
const quantity=value=>{
  const number=Number(value),rounded=Math.round(number*1000)/1000;
  if(!Number.isFinite(number)||number<=0||number>1e9||Math.abs(number-rounded)>1e-8)throw issue('Review the container quantity and units in this product assembly before automatic recovery.');
  return rounded;
};

async function recoveryPlan(stores,record,product,declared,automatic=false){
  let components=Array.isArray(product.components)?product.components:[],basis='current assembly components',productionOrderId='';
  if(record.returned_lot_number){
    const [orders,lots]=await Promise.all([
      readRecords(stores.ProductionOrder,{product_id:product.id,batch_number:record.returned_lot_number}),
      readRecords(stores.StockBalance,{product_id:product.id,lot_number:record.returned_lot_number}),
    ]);
    const ids=[...new Set([...orders.map(p=>p.id),...lots.map(p=>p.production_order_id)].filter(Boolean))];
    if(ids.length>1)throw issue('The returned batch matches several production records. Review its packaging recovery separately.');
    if(ids.length===1){
      const order=orders.find(p=>p.id===ids[0])||await stores.ProductionOrder.get(ids[0]);
      if(!order||order.product_id!==product.id||!['completed','released'].includes(order.status)||!Number.isFinite(Number(order.actual_output))||Number(order.actual_output)<=0)throw issue('The returned batch has incomplete production evidence. Review its packaging recovery separately.');
      const materials=await readRecords(stores.ProductionMaterial,{production_order_id:order.id});
      if(!materials.length)throw issue('The returned batch has no material quantities. Review its packaging recovery separately.');
      productionOrderId=order.id;basis='original production material quantities';
      components=materials.map(material=>{
        const saved=product.components?.find(c=>c.product_id===material.material_id),original=order.assembly_build_components?.find(c=>c.product_id===material.material_id);
        const originalPreference=original?.recover_on_exchange;
        const preference=(automatic||declared!==undefined)&&typeof originalPreference==='boolean'
          ? originalPreference : saved?.recover_on_exchange??originalPreference;
        const consumed=Number(material.consumed_quantity??material.issued_quantity),value=Number(material.total_cost);
        return {product_id:material.material_id,quantity:consumed/Number(order.actual_output),unit:material.unit,original_unit_cost:material.total_cost!=null&&Number.isFinite(value)&&value>=0&&consumed>0?value/consumed:null,...(typeof preference==='boolean'?{recover_on_exchange:preference}:{})};
      });
    }
  }
  const componentIds=[...new Set(components.map(component=>component.product_id).filter(Boolean))];
  const products=componentIds.length?await readRecords(stores.Product,{id:{$in:componentIds}}):[];
  const byId=new Map(products.map(product=>[product.id,product]));
  const totals=new Map();
  for(const component of components){
    const pack=byId.get(component.product_id);
    if(!pack){if(component.recover_on_exchange===true)throw issue('A mapped recovery packaging item is missing. Review this product assembly.');continue;}
    if(!exchangePackagingEnabled(component,pack))continue;
    if(pack.is_active===false||pack.item_removed_at||pack.configuration_status==='draft')throw issue('A mapped recovery packaging item is inactive or incomplete. Review this product assembly.');
    let factor;try{factor=unitFactor(component.unit||stockUnit(pack),stockUnit(pack));}catch{throw issue('The container units do not match the packaging stock unit. Review this product assembly.');}
    const amount=Number(component.quantity)*factor*Number(record.quantity);
    const previous=totals.get(pack.id);
    let price=component.original_unit_cost!=null?component.original_unit_cost/factor:pack.current_cost;
    if(automatic&&component.original_unit_cost==null){
      if(productionOrderId)price=null;
      else if(component.cost_source==='manual')price=component.unit_cost==null?null:Number(component.unit_cost)/factor;
      else if(pack.current_cost!=null||pack.purchase_price!=null||pack.standard_cost!=null){
        try{price=itemUnitCost(pack);}catch{price=null;}
      }
    }
    const costKnown=price!=null&&Number.isFinite(Number(price))&&Number(price)>=0;
    totals.set(pack.id,{product_id:pack.id,product_name:pack.name,unit:stockUnit(pack),inventory_account_id:pack.inventory_account_id,quantity:(previous?.quantity||0)+amount,known:(previous?.known??true)&&costKnown,component_cost:(previous?.component_cost||0)+(costKnown?Number(price)*amount:0)});
  }
  const recovered=declared===undefined?[...totals.values()].map(component=>({product_id:component.product_id,product_name:component.product_name,unit:component.unit,quantity:quantity(component.quantity),...(automatic?{
    disposition:'reuse_review',inventory_account_id:component.inventory_account_id,valuation_ceiling:component.known?Math.floor((component.component_cost+1e-9)*100)/100:null,
  }:{})})):declared.map(input=>{
    const component=totals.get(input.product_id);
    if(!component||!Number.isFinite(component.quantity)||input.quantity>Math.floor((component.quantity+1e-9)*1000)/1000)throw issue('Recovered packaging exceeds this returned product’s recorded assembly or batch quantity. Check the component and physical count.');
    return {product_id:component.product_id,product_name:component.product_name,unit:component.unit,quantity:input.quantity,disposition:input.disposition,valuation_ceiling:component.known?Math.floor((component.component_cost/component.quantity*input.quantity+1e-9)*100)/100:null};
  });
  if(!recovered.length)throw issue('No recoverable container is mapped to this product. Returned goods remain quarantined for recovery review.');
  return {recovered,basis,production_order_id:productionOrderId};
}

export async function planAutomaticExchangePackaging(stores,record,product,replacementValue,treasury){
  let plan;
  try{plan=await recoveryPlan(stores,record,product,undefined,true);}catch(error){
    if(!error.exchangeMappingIssue)throw error;
    return {recovered:[],warnings:[error.message],recovered_value:0};
  }
  const warnings=[];
  const expectedCents=plan.recovered.reduce((sum,row)=>sum+Math.round(Number(row.valuation_ceiling||0)*100),0);
  if(!Number.isSafeInteger(expectedCents)||expectedCents>Math.round(replacementValue*100)){
    warnings.push('The mapped container cost exceeds the replacement stock value. Review the assembly and stock costs before valuing the recovered packaging.');
    return {...plan,recovered:plan.recovered.map(row=>({...row,valuation_ceiling:null,value:0})),warnings,recovered_value:0};
  }
  const rules=await readRecords(stores.PostingRule,{rule_key:{$in:['recovered_packaging_inventory','packaging_inventory']},is_active:true});
  const recoveryRules=rules.filter(rule=>rule.rule_key==='recovered_packaging_inventory');
  const packagingRules=rules.filter(rule=>rule.rule_key==='packaging_inventory');
  const recoveryAccountId=recoveryRules.length===1?recoveryRules[0].account_id:null;
  const packagingAccountId=packagingRules.length===1?packagingRules[0].account_id:null;
  const treasuryIds=new Set(treasury.map(row=>row.gl_account_id));
  let recoveredCents=0;
  for(const row of plan.recovered){
    row.value=0;
    if(row.valuation_ceiling===null){
      warnings.push(`Set a supported component cost for ${row.product_name} before valuing the recovered packaging.`);
      continue;
    }
    if(row.valuation_ceiling===0){row.valued=true;continue;}
    const accountId=recoveryRules.length?recoveryAccountId:row.inventory_account_id||packagingAccountId;
    const account=accountId?await stores.Account.get(accountId):null;
    if(!validPostingRuleAccount(account,'packaging_inventory')||account.is_control_account||account.is_treasury||account.account_number==='1050'||treasuryIds.has(account.id)){
      warnings.push(`Configure a valid packaging inventory account for ${row.product_name} before valuing the recovery.`);
      continue;
    }
    row.value=row.valuation_ceiling;
    row.account_id=account.id;
    row.valued=true;
    recoveredCents+=Math.round(row.value*100);
  }
  return {...plan,warnings,recovered_value:recoveredCents/100};
}

// Convert the exact returned lot created by the checked exchange. A routine
// shelf exchange has a server-valued plan from the replacement journal.
export async function recoverSaleExchangePackaging(svc,{record,product,warehouse,date,user,declared,automatic,journal}){
  const stores=svc.entities,current=await stores.SpoilageRecord.get(record.id);
  if(current?.exchange_packaging_result)return {...current.exchange_packaging_result,reused:true};
  if(declared?.length===0){
    const result={recovered:[],warnings:[],source_record_id:record.id,recovered_value:0};
    await stores.SpoilageRecord.update(record.id,{exchange_packaging_result:result});
    return result;
  }
  let plan=automatic;
  try{plan??=await recoveryPlan(stores,record,product,declared);}catch(error){
    if(!error.exchangeMappingIssue)throw error;
    if(declared!==undefined)throw error;
    const result={recovered:[],warnings:[error.message],source_record_id:record.id};
    await stores.SpoilageRecord.update(record.id,{exchange_packaging_result:result,exchange_packaging_warning:error.message});
    return result;
  }
  if(!plan.recovered.length){
    const result={recovered:[],warnings:plan.warnings,source_record_id:record.id,recovered_value:0};
    await stores.SpoilageRecord.update(record.id,{exchange_packaging_result:result,exchange_packaging_warning:plan.warnings[0]});
    return result;
  }
  if(plan.recovered_value>0&&!journal?.id)throw Error('The packaging recovery journal is missing. No exchange changes were saved.');
  const id=key(record.id),lot='ER-'+record.id;
  const [sources,moves,prior]=await Promise.all([
    readRecords(stores.StockBalance,{product_id:product.id,warehouse_id:warehouse.id,lot_number:lot}),
    readRecords(stores.StockMovement,{document_type:'SpoilageRecord',document_id:record.id,movement_type:'customer_return'}),
    readRecords(stores.StockBalance,{inventory_recovery_id:id}),
  ]);
  const source=sources[0];
  if(sources.length!==1||moves.length!==1||prior.length||source.qc_status!=='quarantine'||Number(source.quantity)!==Number(record.quantity)||Number(source.total_value)!==0||moves[0].product_id!==product.id||moves[0].destination_warehouse_id!==warehouse.id||Number(moves[0].quantity)!==Number(record.quantity)||Number(moves[0].total_value)!==0)throw Error('Reconcile the original exchange return before recovering packaging.');
  const at=new Date().toISOString(),received=!!record.return_received_at;
  await stores.StockBalance.update(source.id,{quantity:0,total_value:0,unit_cost:0,exchange_packaging_recovery_id:id});
  await stores.StockMovement.create({product_id:product.id,product_name:product.name,quantity:record.quantity,unit:stockUnit(product),source_warehouse_id:warehouse.id,lot_number:lot,movement_type:'exchange_contents_removed',movement_date:date,status:'approved',total_value:0,unit_cost:0,document_type:'ExpiryRecovery',document_id:id,exchange_return_record_id:record.id,reason:'Returned contents removed from finished stock; container recovery only',created_by:user.id});
  const recovered=[];
  for(const row of plan.recovered){
    const packLot=id+':'+row.product_id;
    const value=row.value||0,unitCost=value/row.quantity;
    const valuation=row.valued?{inventory_recovery_account_id:row.account_id||null,inventory_recovery_approved_value:value,inventory_recovery_valued_at:at,inventory_recovery_valued_by:user.id,inventory_recovery_value_reference:record.record_number+' / '+plan.basis,inventory_recovery_value_journal_id:value>0?journal.id:null}:{};
    const balance=await stores.StockBalance.create({product_id:row.product_id,product_name:row.product_name,unit:row.unit,warehouse_id:warehouse.id,warehouse_name:warehouse.name,quantity:row.quantity,total_value:value,unit_cost:unitCost,lot_number:packLot,qc_status:'quarantine',inventory_recovery_id:id,inventory_recovery_receipt_required:true,inventory_recovery_source:'sale_exchange',inventory_recovery_return_id:record.id,inventory_recovery_source_balance_id:source.id,...(row.disposition?{inventory_recovery_disposition:row.disposition,inventory_recovery_valuation_ceiling:row.valuation_ceiling}:{}),...valuation,...(received?{inventory_recovery_received_at:at,inventory_recovery_received_by:user.id,inventory_recovery_received_quantity:row.quantity,inventory_recovery_receipt_reference:record.receipt_reference||record.record_number}:{})});
    await stores.StockMovement.create({product_id:row.product_id,product_name:row.product_name,quantity:row.quantity,unit:row.unit,destination_warehouse_id:warehouse.id,lot_number:packLot,movement_type:'packaging_recovery',movement_date:date,status:'approved',total_value:value,unit_cost:unitCost,document_type:'ExpiryRecovery',document_id:id,exchange_return_record_id:record.id,reason:'Container recovered during exchange; held for inspection',created_by:user.id,...(value>0?{journal_id:journal.id,inventory_account_id:row.account_id}:{})});
    recovered.push({...row,balance_id:balance.id,lot_number:packLot,...(value>0?{journal_id:journal.id}:{})});
  }
  const recoveredValue=plan.recovered_value||0;
  const result={source_record_id:record.id,source_balance_id:source.id,recovery_id:id,quantity_basis:plan.basis,production_order_id:plan.production_order_id,recovered,warnings:plan.warnings||[],recovered_value:recoveredValue,journal_id:recoveredValue>0?journal.id:''};
  await stores.SpoilageRecord.update(record.id,{exchange_packaging_result:result,exchange_packaging_recovery_id:id,exchange_packaging_recovered_at:at});
  await stores.AuditLog.create({action:'recover_sale_exchange_packaging',module:'expiry_recovery',entity_type:'SpoilageRecord',entity_id:record.id,user_id:user.id,audit_source:'server_verified',description:automatic?'Recorded mapped shelf exchange packaging and held it for quality inspection':declared!==undefined?'Counted exchange packaging held for accounting valuation and quality disposition':'Recovered mapped exchange containers at zero carrying value; fresh replacement cost unchanged',inventory_recovery_id:id,inventory_recovery_result:result});
  return result;
}

// stockTransfer moves quantities and batch identity. Preserve the inspection
// controls and source link when the actual return bin reaches the factory.
export async function receiveTransferredExchangePackaging(stores,before,destination,user,dispatch){
  for(const source of before.filter(row=>row.inventory_recovery_source==='sale_exchange'&&Number(row.quantity)>0)){
    const matches=await readRecords(stores.StockBalance,{product_id:source.product_id,warehouse_id:destination.id,lot_number:source.lot_number,qc_status:'quarantine'});
    if(matches.length!==1||Number(matches[0].quantity)!==Number(source.quantity)||Number(matches[0].total_value)!==0)throw Error('Reconcile the recovered packaging lot before accepting this return.');
    const metadata=Object.fromEntries(Object.entries(source).filter(([field])=>field.startsWith('inventory_recovery_')));
    await stores.StockBalance.update(matches[0].id,{...metadata,inventory_recovery_received_at:new Date().toISOString(),inventory_recovery_received_by:user.id,inventory_recovery_received_quantity:source.quantity,inventory_recovery_receipt_reference:dispatch.dispatch_number||dispatch.id,inventory_recovery_return_dispatch_id:dispatch.id});
  }
}
