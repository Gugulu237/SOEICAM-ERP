import {isAssemblyInventoryType} from './item-types.js';
import {stockUnit} from './item-units.js';
import {companySalesWarehouse} from './sales-stock.js';
import {STANDARD_VAT_RATE,splitIncludedVat} from './sale-vat.js';

const amount=value=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=1e12?Number(value):null;
const money=value=>Math.round(value*100)/100;

// A catalogue-price estimate: current company stock's carrying cost is the
// authority. Promotional stock already expensed and recovery stock never dilute
// that basis. No stock writes or component/production-cost updates occur here.
export function finishedGoodsMargins(products,balances,warehouses){
 const company=new Set(warehouses.filter(companySalesWarehouse).map(row=>row.id)),stock=new Map();
 for(const row of balances){
  if(!company.has(row.warehouse_id)||row.degustation_appropriation_id||row.inventory_recovery_disposition||row.inventory_recovery_id)continue;
  const quantity=amount(row.quantity),value=amount(row.total_value);
  if(quantity===0&&(!value||value===0))continue;
  const current=stock.get(row.product_id)||{quantity:0,value:0,invalid:false};
  if(quantity==null||value==null||quantity===0&&value!==0)current.invalid=true;
  else {current.quantity+=quantity;current.value+=value;}
  stock.set(row.product_id,current);
 }
 const result=new Map();
 for(const product of products){
  if(!isAssemblyInventoryType(product.inventory_type))continue;
  const current=stock.get(product.id),recorded=amount(product.current_cost),selling=amount(product.selling_price);
  const cost=current?.quantity>0?current.value/current.quantity:recorded;
  const costBasis=current?.quantity>0?'company_stock':'registered_cost';
  const net=selling>0?splitIncludedVat(selling,STANDARD_VAT_RATE).net:null;
  const validCost=!current?.invalid&&cost!=null&&Number.isFinite(cost)&&cost>0;
  const profit=validCost&&net>0?net-cost:null;
  result.set(product.id,{status:current?.invalid?'invalid_stock':!validCost?'missing_cost':!(net>0)?'missing_price':'available',cost_basis:validCost?costBasis:null,unit:stockUnit(product),vat_rate:STANDARD_VAT_RATE,selling_price:selling,net_selling_price:net,production_unit_cost:validCost?cost:null,gross_profit_per_unit:profit==null?null:money(profit),gross_margin_percent:profit==null?null:profit/net*100});
 }
 return result;
}

export function finishedGoodsMargin(product,balances=[],warehouses=[]){return finishedGoodsMargins([product],balances,warehouses).get(product.id)||null;}
