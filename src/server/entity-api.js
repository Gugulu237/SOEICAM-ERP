import {refreshAssemblyPrices} from './domain/assembly-price-sync.js';
import {entityFeatureContext} from './feature-access.js';
import {preparePostingRule} from './domain/posting-rule-definition.js';
import {prepareTreasuryAccount} from './domain/treasury-definition.js';
import {audit} from './domain/field-ops.js';
import {guardTreasuryReferences} from '../lib/treasury-access.js';
import {employeeRoleChange} from './domain/employee-role-change.js';
import 'server-only';
import { serviceEntities, entityStore } from './entities.js';
import { transaction,database } from './db.js';
import { catalogueFromStored } from './domain/role-catalogue.js';
import { recordScope, guardMutation, visibleRecord, forbidden, requireActiveContext } from './access.js';
import { recordItemMetadataChange } from './domain/item-metadata-audit.js';
import { prepareProductDefinition } from './domain/product-definition.js';
import { guardDispatchMutation } from './domain/dispatch-mutations.js';
import { prepareVehicleDefinition } from './domain/vehicle-locations.js';
import { prepareProductionBatch } from './domain/production-batches.js';
import { prepareDeliveryDefinition } from './domain/customer-delivery.js';
import { guardPurchaseMutation } from './domain/purchase-workspace.js';
import { normalizeRole } from './domain/roles.js';
import { guardStockStorage } from './domain/stock-storage.js';
import { prepareWarehouseDefinition } from './domain/warehouse-definition.js';
import { authenticatedRecordChanges, recordAuthenticatedDecision } from './domain/employee-action-access.js';
import { guardRecipeMutation, finishRecipeApproval } from './domain/recipe-integrity.js';

export async function entityOperation(context,name,operation,args = []) {
  context=entityFeatureContext(context,name,operation);
  if (!Array.isArray(args) || args.length > 5) throw new Error('Invalid arguments');
  const allowed = ['filter','list','get','count','aggregate','create','bulkCreate','update','updateMany','delete','deleteMany'];
  if (!allowed.includes(operation)) throw forbidden('Unsupported table operation.');
  const store = entityStore(name), scope = await recordScope(context,name,operation,serviceEntities);
  const queryWithScope = query => ({ $and:[scope,query || {}] });
  const display = value => Array.isArray(value) ? value.map(row=>visibleRecord(context,name,row)) : value?.items ? { ...value,items:value.items.map(row=>visibleRecord(context,name,row)) } : visibleRecord(context,name,value);
  if (operation === 'filter') return display(await store.filter(queryWithScope(args[0]),...args.slice(1)));
  if (operation === 'list') return display(await store.filter(scope,...args));
  if (operation === 'get') return display((await store.filter(queryWithScope({ id:String(args[0]) }),'id',1))[0] || null);
  if (operation === 'count') return store.count(queryWithScope(args[0]));
  if (operation === 'aggregate') {
    if (['Employee','User'].includes(name) && context.role !== 'admin') throw forbidden('Staff aggregate reports require the General Manager.');
    return store.aggregate({ ...args[0],query:queryWithScope(args[0]?.query) });
  }
  // A journal is one document: its lines, balances, numbering and audit must
  // commit together. Even draft writes use the checked accounting endpoint so
  // callers cannot append a line to a posted entry or forge posting metadata.
  if (['JournalEntry','JournalLine'].includes(name)) throw forbidden('Use the checked Accounting journal workflow. Posted journals and their lines are immutable and cannot be edited or deleted.');
  if (['PayrollRun','PayrollLine'].includes(name)) throw forbidden('Use the checked Payroll workflow to calculate, approve and post a complete payroll run.');
  return transaction(async () => {
    let employeeCatalogue=null;
    if(name==='Employee'&&!['delete','deleteMany'].includes(operation)){
      const rows=await database().unsafe('SELECT extra_data FROM public.company_settings ORDER BY created_date LIMIT 1 FOR UPDATE');
      const catalogue=catalogueFromStored(rows[0]?.extra_data?.staff_role_catalogue);employeeCatalogue=catalogue;
      const inputs=operation==='bulkCreate'?args[0]:[operation==='create'?args[0]:args[1]];
      for(const input of inputs || [])if(input?.role&&!Object.hasOwn(catalogue.roles,normalizeRole(input.role)||input.role))throw forbidden('Choose a configured system role.');
    }
    if (operation === 'create' || operation === 'bulkCreate') {
      const rows = operation === 'create' ? [args[0]] : args[0];
      if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid record batch');
      for (const row of rows) {
        if (name === 'Employee' && row.role && row.role !== 'admin' && !(context.roleCatalogue?.roles?.[row.role] || (!context.roleCatalogue && normalizeRole(row.role) === row.role))) throw forbidden('Choose a configured system role.');
        await guardTreasuryReferences(serviceEntities,requireActiveContext(context),row);
        guardMutation(context,name,operation,row);
        if(name==='JournalLine' && ['assets','inventory_audit','inventory_adjustment','opening_balances'].includes((await serviceEntities.JournalEntry.get(row.journal_id))?.source_module)) throw forbidden('Asset and inventory audit journal lines are immutable.');
        await guardStockStorage(serviceEntities,name,operation,row,null);
        guardPurchaseMutation(context,name);
        await guardDispatchMutation(context,name,operation,row,null,serviceEntities);
        await guardRecipeMutation(serviceEntities,context,name,operation,row,null);
      }
      const saved=[];
      for (const row of rows) {
        const prepared = name==='PostingRule'?await preparePostingRule(serviceEntities,context,row):name==='TreasuryAccount'?await prepareTreasuryAccount(serviceEntities,context,row):name === 'Warehouse' ? await prepareWarehouseDefinition(serviceEntities,row) : name === 'Product' ? await prepareProductDefinition(serviceEntities, row) : name === 'Vehicle' ? await prepareVehicleDefinition(serviceEntities, row) : name === 'ProductionOrder' ? await prepareProductionBatch(serviceEntities, row) : ['Customer','CustomerLocation'].includes(name) ? await prepareDeliveryDefinition(serviceEntities,row,null,context) : row;
        const value = { ...authenticatedRecordChanges(context,name,prepared), created_by:context.user.email };
        const record=await store.create(value);
        if(name==='PostingRule')await audit({entities:serviceEntities},{action:'create_posting_rule',module:'accounting',entityType:name,entityId:record.id,userId:context.user.id,description:'Configured '+record.rule_key+' to '+record.account_number});
        if(name==='TreasuryAccount')await audit({entities:serviceEntities},{action:'create_treasury_account',module:'accounting',entityType:name,entityId:record.id,userId:context.user.id,description:'Linked treasury account '+record.name+' to '+record.gl_account_number});
        if(name==='Recipe')await finishRecipeApproval(serviceEntities,context,null,record);
        if(name==='Product')await recordItemMetadataChange(serviceEntities,context,null,record);
        await recordAuthenticatedDecision(serviceEntities,context,name,null,record);
        saved.push(record);
      }
      return operation === 'create' ? saved[0] : saved;
    }
    const query = queryWithScope(['update','delete'].includes(operation) ? { id:String(args[0]) } : args[0]);
    const existing = await store.filter(query,'id',1000);
    if (!existing.length) throw Object.assign(new Error('Record not found in your permitted scope.'),{ status:404 });
    if (existing.length >= 1000) throw new Error('Split this change into smaller batches.');
    for (const row of existing) {
      if (name === 'Employee' && args[1]?.role && args[1].role !== 'admin' && !(context.roleCatalogue?.roles?.[args[1].role] || (!context.roleCatalogue && normalizeRole(args[1].role) === args[1].role))) throw forbidden('Choose a configured system role.');
      await guardTreasuryReferences(serviceEntities,requireActiveContext(context),args[1],row);
      guardMutation(context,name,operation,args[1] || {},row);
      if(name==='JournalLine') for(const id of [row.journal_id,args[1]?.journal_id].filter(Boolean)) if(['assets','inventory_audit','inventory_adjustment','opening_balances'].includes((await serviceEntities.JournalEntry.get(id))?.source_module)) throw forbidden('Asset and inventory audit journal lines are immutable.');
      await guardStockStorage(serviceEntities,name,operation,args[1] || {},row);
      guardPurchaseMutation(context,name);
      await guardDispatchMutation(context,name,operation,args[1] || {},row,serviceEntities);
      await guardRecipeMutation(serviceEntities,context,name,operation,args[1] || {},row);
    }
    if (operation === 'delete' || operation === 'deleteMany') return store.deleteMany(query);
    if (['PostingRule','TreasuryAccount','Warehouse','Product','Vehicle','ProductionOrder','Customer','CustomerLocation'].includes(name)) {
      const records = [];
      for (const row of existing) {
        const definition = name==='PostingRule'?await preparePostingRule(serviceEntities,context,args[1],row):name==='TreasuryAccount'?await prepareTreasuryAccount(serviceEntities,context,args[1],row):name === 'Warehouse' ? await prepareWarehouseDefinition(serviceEntities,args[1],row) : name === 'Product' ? await prepareProductDefinition(serviceEntities, args[1], row) : name === 'Vehicle' ? await prepareVehicleDefinition(serviceEntities, args[1], row) : name === 'ProductionOrder' ? await prepareProductionBatch(serviceEntities, args[1], row) : await prepareDeliveryDefinition(serviceEntities,args[1],row,context);
        const record=await store.update(row.id, authenticatedRecordChanges(context,name,definition,row));
        if(name==='TreasuryAccount')await audit({entities:serviceEntities},{action:'update_treasury_account',module:'accounting',entityType:name,entityId:record.id,userId:context.user.id,description:'Updated treasury settings for '+record.name});
        if(name==='PostingRule')await audit({entities:serviceEntities},{action:'update_posting_rule',module:'accounting',entityType:name,entityId:record.id,userId:context.user.id,description:'Changed '+record.rule_key+' from '+row.account_number+' to '+record.account_number});
        if(name==='Product'){await recordItemMetadataChange(serviceEntities,context,row,record);if(['purchase_price','components','unit_of_measure','inventory_type','standard_cost','current_cost'].some(k=>Object.hasOwn(definition,k)))await refreshAssemblyPrices(serviceEntities,record.id);}
        records.push(record);
      }
      return operation === 'update' ? records[0] : { updated: records.length, modifiedCount: records.length, modified_count: records.length, records };
    }
    if (['ExpenseRequest','Payment','Recipe','Employee'].includes(name)) {
      const records=[];
      for(const row of existing){
        const record=await store.update(row.id,authenticatedRecordChanges(context,name,name==='Employee'?employeeRoleChange(row,args[1],employeeCatalogue,context):args[1],row));
        if(name==='Recipe')await finishRecipeApproval(serviceEntities,context,row,record);
        await recordAuthenticatedDecision(serviceEntities,context,name,row,record);
        records.push(record);
      }
      return operation==='update'?records[0]:{updated:records.length,modifiedCount:records.length,modified_count:records.length,records};
    }
    const result = await store.updateMany(query,args[1]);
    return operation === 'update' ? result.records[0] : result;
  });
}
