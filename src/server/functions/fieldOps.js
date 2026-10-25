import {salesOrderAction,SALES_ORDER_ACTIONS} from '../domain/sales-orders.js';
import { CUSTOMER_REGISTRATION_ACTIONS, customerRegistrationAction } from '../domain/customer-registration.js';
import { fieldInventoryAction } from '../domain/field-stock-inventory.js';
import { isTransactionConflict } from '../transaction-errors.js';
import { INVENTORY_AUDIT_ACTIONS, inventoryAuditAction } from '../domain/inventory-audit.js';
import { WAREHOUSE_ADJUSTMENT_ACTIONS, warehouseAdjustmentAction } from '../domain/warehouse-adjustment.js';
import { cashFlowReport } from '../domain/cash-flow.js';
import { ASSET_ACTIONS, fixedAssetAction } from '../domain/fixed-assets.js';
import { cashierAction, CASHIER_ACTIONS } from '../domain/cashier-workspace.js';
import { productionAction } from '../domain/production-batches.js';
import { YOGURT_ACTIONS, yogurtAction } from '../domain/yogurt-production.js';
import { productionPurchaseAction } from '../domain/production-purchasing.js';
import { batchTraceAction } from '../domain/batch-trace.js';
import { accountPosition } from '../domain/account-position.js';
import { supplierAction, SUPPLIER_ACTIONS } from '../domain/supplier-workspace.js';
import { purchaseWorkspace, purchasePaymentDecision } from '../domain/purchase-workspace.js';
import { distributionControlAction, DISTRIBUTION_ACTIONS } from '../domain/distribution-control.js';
import { saleItemPostings } from '../../lib/item-posting.js';
import { outletAction } from '../domain/outlet-workspace.js';
import { supplyRun, assertRunSupplyStock } from '../domain/commercial-runs.js';
import { dispatchAction } from '../domain/dispatch-operations.js';
import { stockUnit } from '../../lib/item-units.js';
import { fieldSupplyPayment } from '../../lib/commercial-daily.js';
import { employeeWorkspaceAction } from '../domain/employee-workspace.js';
import { commercialAction, readRecords } from '../domain/commercial-workspace.js';
import { finishedProduct, periodDates } from '../domain/commercial-rules.js';
import { createClientFromRequest } from '../request-client.js';
import { commercialActor } from '../domain/commercial-actor.js';
import { normalizeSaleReplacements, combinedSupplyQuantities } from '../../lib/sale-replacements.js';
import { commercialReturnAction, postSaleReplacements } from '../domain/commercial-returns.js';
import { companySalesAction } from '../domain/company-sales.js';
import { invoiceAction, INVOICE_ACTIONS } from '../domain/sales-invoices.js';
import { customerDeliveryAction,CUSTOMER_DELIVERY_ACTIONS } from '../domain/customer-delivery.js';
import {
  round2, round3, today, requireStaff, getRuleAccount, getAccountByNumber,
  nextSequence, postJournal, stockIssue,
  claimField, audit,
} from '../domain/field-ops.js';

const addDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

async function loadProducts(client, ids) {
  const products = await client.entities.Product.filter({ id: { $in: ids } });
  const map = {};
  products.forEach((p) => { map[p.id] = p; });
  return map;
}

// The accounting policy for a field sale, read from the configured posting rules.
// Used both to preview the journal and to post it, so the preview cannot drift
// from what actually gets posted.
async function buildSaleJournal(client, sale, lines) {
  const receivable = await getRuleAccount(client, 'customer_receivable');
  const taxPayable = Number(sale.tax_total) > 0 ? await getRuleAccount(client, 'tax_payable') : null;
  // Cash collected in the field is company money held by the Commercial, not yet
  // in a treasury account: it clears through the cash-in-transit account.
  const clearing = await getAccountByNumber(client, '1050');

  const net = round2(sale.subtotal);
  const tax = round2(sale.tax_total);
  const cost = round2(sale.cost_of_goods);
  const payment = fieldSupplyPayment(sale);
  // FieldSaleLine stores its net value, unlike invoice lines whose total
  // includes tax. Present the shared posting engine with its gross contract.
  const postingLines = lines.map(line => ({ ...line, line_total: round2(Number(line.line_total) + Number(line.tax_amount || 0)) }));
  const itemLines = await saleItemPostings(client.entities, postingLines, { netTotal: net, costTotal: cost,
    fallback: field => getRuleAccount(client, { revenue_account_id: 'sales_revenue', cogs_account_id: 'direct_material_cogs', inventory_account_id: 'finished_goods_inventory' }[field]),
  });

  const plan = [
    {
      account_id: clearing.id, account_number: clearing.account_number, account_name: clearing.account_name,
      debit: payment.collected, credit: 0,
      description: sale.payment_type === 'cash'
        ? `Cash in transit — collected by ${sale.commercial_name}`
        : `Receivable — ${sale.customer_name}`,
      party_type: 'customer', party_id: sale.customer_id,
    },
    {
      account_id: receivable.id, account_number: receivable.account_number, account_name: receivable.account_name,
      debit: payment.due, credit: 0, description: `Receivable - ${sale.customer_name}`,
      party_type: 'customer', party_id: sale.customer_id,
    },
    ...itemLines,
  ];

  if (tax > 0) {
    plan.push({
      account_id: taxPayable.id, account_number: taxPayable.account_number, account_name: taxPayable.account_name,
      debit: 0, credit: tax, description: `Tax on ${sale.sale_number}`,
    });
  }


  return plan.filter(line => line.debit > 0 || line.credit > 0);
}

// The request route wraps each write in one serializable transaction. Stock,
// customer receivables, collected cash and this journal commit together.
async function recordSaleAccounting(svc, sale, lines, actor, automatic = false) {
  if (sale.status === 'approved_posted') return { journal: { id: sale.journal_id, journal_number: sale.journal_number }, reused: true };
  const plan = await buildSaleJournal(svc, sale, lines);
  const result = await postJournal(svc, {
    entryDate: sale.transaction_date,
    description: `Field sale ${sale.sale_number} - ${sale.customer_name} (${sale.commercial_name})`,
    sourceModule: 'field_sales', sourceDocumentType: 'FieldSale', sourceDocumentId: sale.id,
    userId: actor.id, lines: plan,
  });
  const now = new Date().toISOString(), unpaid = fieldSupplyPayment(sale).due;
  if (unpaid > 0 && !sale.receivable_recorded_at) {
    const customer = await svc.entities.Customer.get(sale.customer_id);
    if (!customer) throw new Error('The supplied customer no longer exists');
    await svc.entities.Customer.update(customer.id, { balance: round2((customer.balance || 0) + unpaid) });
  }
  await svc.entities.FieldSale.update(sale.id, {
    status: 'approved_posted', journal_id: result.journal.id, journal_number: result.journal.journal_number || '',
    posting_mode: automatic ? 'automatic' : 'reviewed', posted_by: actor.id, posted_at: now,
    approved_by: automatic ? '' : actor.name, approved_at: automatic ? '' : now,
    receivable_recorded_at: sale.receivable_recorded_at || now, posting_error: '',
  });
  await audit(svc, { action: automatic ? 'record_field_sale' : 'approve_field_sale', module: 'field_sales',
    entityType: 'FieldSale', entityId: sale.id, userId: actor.id,
    description: `${automatic ? 'Recorded on submission' : 'Approved and posted'} ${sale.sale_number} (${result.journal.journal_number}) - ${sale.total} XAF`,
  });
  return result;
}

export default async function (req) {
  try {
    const base44 = await createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // The user-scoped client authenticates the caller; protected writes run with
    // the service role only after the role has been checked below.
    const svc = base44.asServiceRole;

    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!action) return Response.json({ error: 'An action is required' }, { status: 400 });
    // The function client uses service entities after its existing fine-grained
    // role checks. Apply the GM's module selection before entering that code.
    const inActions = (actions) => actions.includes(action);
    // Report-only Supply Chain grants use sales_reports, without opening the
    // agent's operational Commercial module. The report handler checks both.
    if (action === 'commercialPerformance') return Response.json(await commercialAction(base44,user,body));
    if (CUSTOMER_REGISTRATION_ACTIONS.includes(action)) return Response.json(await customerRegistrationAction(base44, user, body));
    if (action === 'fieldStockInventory') return Response.json(await fieldInventoryAction(base44, user, body));
    if (['expiredReturnReviewQueue', 'verifyExpiredReturn', 'rejectExpiredReturn', 'commercialReturns', 'driverReturnsWorkspace', 'recordExpiredReturn', 'replaceExpiredReturn'].includes(action)) return Response.json(await commercialReturnAction(base44, user, body));
    const module = action==='releaseYogurtLot' ? 'quality' : YOGURT_ACTIONS.includes(action) ? 'manufacturing' : WAREHOUSE_ADJUSTMENT_ACTIONS.includes(action) ? 'inventory_adjustments' : ASSET_ACTIONS.includes(action) || INVENTORY_AUDIT_ACTIONS.includes(action) ? 'accounting' : (INVOICE_ACTIONS.includes(action) || SALES_ORDER_ACTIONS.includes(action)) ? 'sales'
      : CUSTOMER_DELIVERY_ACTIONS.includes(action) || inActions(['registerCustomer','fieldCustomers','verifyFieldCustomer','updateCustomerGps']) ? 'customers'
      : SUPPLIER_ACTIONS.includes(action) || inActions(['purchasesWorkspace','approvePurchasePayment','rejectPurchasePayment']) ? 'purchases'
      : DISTRIBUTION_ACTIONS.includes(action) || inActions(['loadDispatch','returnDispatchStock','dispatchReconciliation','approveDispatch','approveDispatchRequest','dispatchActivity','driverActivity','issueCustody','returnCustody']) ? 'distribution'
      : CASHIER_ACTIONS.includes(action) || action === 'submitHandover' ? 'cashier'
      : inActions(['startFermentation','saveProductionPlan','completeProduction','approveProductionOrder','rejectProductionOrder','issueProductionMaterials','productionPurchaseOptions','requestProductionPurchase','checkProductionMaterials','requestProductionAudit','productionAuditRequests','resolveProductionAudit']) ? 'manufacturing'
      : inActions(['batchCatalogue','batchTrace']) ? 'quality'
      : ['accountPosition', 'cashFlowReport'].includes(action) ? 'accounting'
      : inActions(['submitOutletVisit','submitDeliveryShelfCheck','outletShelfOverview','outletReports','outletRoster','assignHotesse','createAssignedOutlet','reviewOutletVisit']) ? 'outlets'
      : inActions(['commercialDepositCash','commercialCashiers','registerCustomer','fieldCustomers','commercialPerformance','verifyFieldCustomer','commercialDailySupplies','updateCustomerGps','commercialReturns','recordExpiredReturn','replaceExpiredReturn','saveSale','proposedJournal','approveSale','returnSale','rejectSale']) ? 'commercial'
      : null;
    if (!module && !['employeeDashboard','companySales'].includes(action)) throw new Error('Unknown function action.');
    if (module) base44.auth.assertModule?.(module);
    if (YOGURT_ACTIONS.includes(action)) return Response.json(await yogurtAction(base44,user,body));
    if (WAREHOUSE_ADJUSTMENT_ACTIONS.includes(action)) return Response.json(await warehouseAdjustmentAction(base44,user,body));
    if (ASSET_ACTIONS.includes(action)) return Response.json(await fixedAssetAction(base44,user,body));
    if (INVENTORY_AUDIT_ACTIONS.includes(action)) return Response.json(await inventoryAuditAction(base44,user,body));
    if (SALES_ORDER_ACTIONS.includes(action)) return Response.json(await salesOrderAction(base44,user,body));
    if (INVOICE_ACTIONS.includes(action)) return Response.json(await invoiceAction(base44,user,body));
    if (CUSTOMER_DELIVERY_ACTIONS.includes(action)) return Response.json(await customerDeliveryAction(base44,user,body));
    if (SUPPLIER_ACTIONS.includes(action)) return Response.json(await supplierAction(base44, user, body));
    if (action === 'purchasesWorkspace') return Response.json(await purchaseWorkspace(base44,user,body));
    if (['approvePurchasePayment','rejectPurchasePayment'].includes(action)) return Response.json(await purchasePaymentDecision(base44,user,body));
    if (DISTRIBUTION_ACTIONS.includes(action)) return Response.json(await distributionControlAction(base44,user,body));
    if (CASHIER_ACTIONS.includes(action)) return Response.json(await cashierAction(base44, user, body));
    if (['productionPurchaseOptions','requestProductionPurchase'].includes(action)) return Response.json(await productionPurchaseAction(base44,user,body));
    if (['startFermentation','saveProductionPlan', 'completeProduction','approveProductionOrder','rejectProductionOrder','issueProductionMaterials','checkProductionMaterials','requestProductionAudit','productionAuditRequests','resolveProductionAudit'].includes(action)) return Response.json(await productionAction(base44, user, body));
    if (['batchCatalogue', 'batchTrace'].includes(action)) return Response.json(await batchTraceAction(base44, user, body));
    if (action === 'accountPosition') return Response.json(await accountPosition(base44, user, body));
    if (action === 'cashFlowReport') return Response.json(await cashFlowReport(base44, user, body));
    if (action === 'companySales') return Response.json(await companySalesAction(base44, user, body));


    if (['loadDispatch', 'returnDispatchStock', 'dispatchReconciliation', 'approveDispatch', 'approveDispatchRequest'].includes(action)) {
      return Response.json(await dispatchAction(base44, user, body));
    }

    if (['submitOutletVisit', 'submitDeliveryShelfCheck', 'outletShelfOverview', 'outletReports', 'outletRoster', 'assignHotesse', 'createAssignedOutlet', 'reviewOutletVisit'].includes(action)) {
      return Response.json(await outletAction(base44, user, body));
    }

    if (['commercialDepositCash', 'commercialCashiers', 'registerCustomer', 'fieldCustomers', 'commercialPerformance', 'verifyFieldCustomer', 'commercialDailySupplies', 'updateCustomerGps'].includes(action)) {
      return Response.json(await commercialAction(base44, user, body));
    }

    if (['employeeDashboard', 'driverActivity', 'dispatchActivity'].includes(action)) {
      return Response.json(await employeeWorkspaceAction(base44, user, body));
    }

    // ---------------------------------------------------------------- custody

    if (['issueCustody','returnCustody'].includes(action)) throw new Error('Distribution now manages only finished products through paired vehicle runs. Use Distribution stock control to issue goods, receive vehicle returns or recover legacy custody.');

    // ------------------------------------------------------------- field sales

    if (action === 'saveSale') {
      const { employee, role } = await commercialActor(base44, user, body.commercialId, 'recording a field sale');
      if (!employee) throw new Error('Your login is not linked to a staff record — ask an administrator to link it');
      if (employee.status && employee.status !== 'active') throw new Error('An active linked commercial account is required');

      const submit = !!body.submit;
      if (!body.saleId && (typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.idempotencyKey))) throw new Error('A valid supply request reference is required. Reopen the sale form.');
      const transactionDate = body.transactionDate || today();
      if (submit && !['cash', 'credit'].includes(body.paymentType)) throw new Error('Choose whether cash was collected or this supply is on credit');
      if (body.paymentType != null && body.paymentType !== '' && !['cash', 'credit'].includes(body.paymentType)) throw new Error('Choose cash or credit for this supply');
      const paymentType = ['cash', 'credit'].includes(body.paymentType) ? body.paymentType : null;
      periodDates(transactionDate, transactionDate);
      if (!body.customerId) throw new Error('Select the customer being supplied');

      const customer = await svc.entities.Customer.get(body.customerId);
      if (!customer || customer.is_active === false) throw new Error('Choose an active customer');
      const location = body.locationId ? await svc.entities.CustomerLocation.get(body.locationId) : null;
      if (body.locationId && (!location || location.customer_id !== customer.id || location.is_active === false)) throw new Error('Choose an active outlet belonging to this customer');
      if (submit && !location) {
        const outlets = await readRecords(svc.entities.CustomerLocation, { customer_id: customer.id, is_active: { $ne: false } });
        if (outlets.some(row => Array.isArray(row.assigned_hotesse_ids) && row.assigned_hotesse_ids.length)) throw new Error('Select the exact point of sale receiving these goods so its Hotesse can see the delivery and batches.');
      }

      let sale = body.saleId ? await svc.entities.FieldSale.get(body.saleId) : null;
      if (body.saleId && !sale) throw new Error('Sale not found');
      if (sale && sale.commercial_id !== employee.id) throw new Error('This sale belongs to another Commercial');
      if (!sale && body.idempotencyKey) sale = (await readRecords(svc.entities.FieldSale, { commercial_id: employee.id, idempotency_key: body.idempotencyKey }))[0] || null;
      if (sale && (sale.stock_moved_at || !['draft', 'returned'].includes(sale.status))) {
        if (body.idempotencyKey && sale.idempotency_key === body.idempotencyKey) return Response.json({ sale, reused: true });
        throw new Error('A submitted or stock-moved supply is locked. Contact an administrator for corrections.');
      }
      const run = await supplyRun(svc, employee.id, body.dispatchId, transactionDate, submit);

      const inputLines = Array.isArray(body.lines) ? body.lines : [];
      if (!inputLines.length || inputLines.length > 50 || inputLines.some(l => !l || typeof l.product_id !== 'string' || typeof l.quantity === 'boolean' || !Number.isFinite(Number(l.quantity)) || round3(l.quantity) <= 0) || new Set(inputLines.map(l => l.product_id)).size !== inputLines.length) throw new Error('Add valid positive quantities for distinct products');
      const replacements = normalizeSaleReplacements(body.stockReplacements, transactionDate);
      if (replacements.length && transactionDate > today()) throw Error('Stock replacements cannot be recorded in the future');
      const combinedLines = combinedSupplyQuantities(inputLines, replacements);
      if (combinedLines.length > 50) throw Error('Choose at most 50 distinct products for the supply and replacements');
      const products = await loadProducts(svc, combinedLines.map(l => l.product_id));
      for (const row of replacements) {
        const product = products[row.product_id];
        if (!finishedProduct(product) || product.is_active === false || product.configuration_status === 'draft') throw Error('Choose an active finished product for each replacement');
      }

      const lines = [];
      let subtotal = 0;
      let discountTotal = 0;
      let taxTotal = 0;

      for (const l of inputLines) {
        const product = products[l.product_id];
        if (!product) throw new Error('A selected product no longer exists');
        if (!finishedProduct(product)) throw new Error('Field sales accept only finished products and assemblies');
        if (product.is_active === false || product.configuration_status === 'draft') throw new Error(`${product.name} is not ready for sale`);
        const qty = round3(l.quantity);
        const listPrice = round2(product.selling_price);
        const unitPrice = l.unit_price === '' || l.unit_price == null ? listPrice : round2(l.unit_price);
        if (unitPrice <= 0) throw new Error(`${product.name} has no authorized selling price — set one on the item first`);
        if (unitPrice < listPrice && role !== 'admin') {
          throw new Error(`${product.name} sells at ${listPrice} XAF — selling below the authorized price needs an authorized discount`);
        }
        const lineTotal = round2(unitPrice * qty);
        const discount = round2(Math.max(0, listPrice - unitPrice) * qty);
        const taxRate = Number(product.tax_rate) || 0;
        const taxAmount = round2((lineTotal * taxRate) / 100);
        subtotal = round2(subtotal + lineTotal);
        discountTotal = round2(discountTotal + discount);
        taxTotal = round2(taxTotal + taxAmount);
        lines.push({ product, qty, unitPrice, listPrice, discount, taxRate, taxAmount, lineTotal });
      }

      const total = round2(subtotal + taxTotal);

      if (paymentType === 'credit') {
        if (customer.credit_status === 'blocked') throw new Error(`${customer.business_name} is blocked for credit sales`);
        const limit = round2(customer.credit_limit || 0);
        const overLimit = limit > 0 && round2((customer.balance || 0) + total) > limit;
        if (overLimit && !(role === 'admin' && String(body.creditOverrideReason || '').trim())) {
          throw new Error(`This sale takes ${customer.business_name} over the credit limit of ${limit} XAF — an authorized override with a reason is required`);
        }
      }

      if (typeof body.amountCollected === 'boolean' || (body.amountCollected != null && body.amountCollected !== '' && !Number.isFinite(Number(body.amountCollected)))) throw new Error('Enter a valid cash amount');
      if (submit && paymentType === 'cash' && (body.amountCollected === '' || body.amountCollected == null)) throw new Error('Enter the exact cash collected; choose credit when no cash was collected');
      if (paymentType === 'credit' && Number(body.amountCollected || 0) !== 0) throw new Error('A credit supply cannot declare cash collected; choose cash and enter the amount collected');
      const cashPortion = paymentType === 'cash'
        ? round2(body.amountCollected === '' || body.amountCollected == null ? 0 : body.amountCollected)
        : 0;
      if (!Number.isFinite(cashPortion) || cashPortion < 0) throw new Error('Enter a valid cash amount');
      if (submit && paymentType === 'cash' && cashPortion <= 0) throw new Error('Choose credit when no cash was collected');
      if (cashPortion > total) throw new Error('The amount collected cannot exceed the sale total');
      const amountDue = round2(total - cashPortion);
      if (paymentType === 'cash' && amountDue > 0) {
        if (customer.credit_status === 'blocked') throw new Error('This customer is blocked for an unpaid supply balance');
        const limit = round2(customer.credit_limit || 0);
        if (limit > 0 && round2((customer.balance || 0) + amountDue) > limit && !(role === 'admin' && String(body.creditOverrideReason || '').trim())) throw new Error('The unpaid balance exceeds this customer\'s credit limit');
      }

      let receiptUris = (Array.isArray(body.receiptFileUris) ? body.receiptFileUris : []).filter(Boolean);
      if (receiptUris.length > 8 || receiptUris.some(uri => typeof uri !== 'string' || !uri.startsWith('private/') || uri.length > 2000)) throw new Error('Attach valid private receipt photos');
      const receiptReference = String(body.receiptReference || '').trim();
      if (submit) {
        if (!receiptUris.length) throw new Error('A readable photograph of the supply receipt is required to record the sale');
        if (!receiptReference) throw new Error('The receipt reference is required to record the sale');
        receiptUris = await base44.validateReceiptPhotos(receiptUris, employee.id);
        await assertRunSupplyStock(svc, run, combinedLines, transactionDate);
      }

      const terms = body.paymentTermsDays === '' || body.paymentTermsDays == null ? Number(customer.payment_terms_days) || 0 : Number(body.paymentTermsDays);
      if (!Number.isSafeInteger(terms) || terms < 0 || terms > 3650) throw new Error('Choose valid whole-number payment terms between 0 and 3650 days');
      const payload = {
        ...run,
        commercial_id: employee.id,
        commercial_name: employee.full_name,
        recorded_by: user.id,
        customer_id: customer.id,
        customer_name: customer.business_name || '',
        location_id: location?.id || '',
        location_name: location?.name || '',
        transaction_date: transactionDate,
        payment_type: paymentType,
        subtotal,
        discount_total: discountTotal,
        tax_total: taxTotal,
        total,
        amount_collected: cashPortion,
        collection_date: cashPortion > 0 ? (body.collectionDate || transactionDate) : '',
        amount_due: amountDue,
        payment_terms_days: terms,
        due_date: amountDue > 0 ? addDays(transactionDate, terms) : '',
        receipt_reference: receiptReference,
        receipt_file_uris: receiptUris,
        stock_replacements: replacements,
        notes: body.notes || '',
        status: submit ? 'submitted' : 'draft',
        submitted_at: submit ? new Date().toISOString() : '',
        credit_override_by: paymentType === 'credit' && body.creditOverrideReason ? (employee.full_name || user.full_name) : '',
        credit_override_reason: body.creditOverrideReason || '',
      };

      if (!sale) {
        payload.sale_number = await nextSequence(svc, 'next_field_sale_number', 'FS', 6);
        payload.idempotency_key = body.idempotencyKey || '';
        sale = await svc.entities.FieldSale.create(payload);
      } else {
        await svc.entities.FieldSale.update(sale.id, payload);
        await svc.entities.FieldSaleLine.deleteMany({ field_sale_id: sale.id });
      }

      await svc.entities.FieldSaleLine.bulkCreate(lines.map((l) => ({
        field_sale_id: sale.id,
        product_id: l.product.id,
        product_name: l.product.name,
        unit: stockUnit(l.product),
        quantity: l.qty,
        unit_price: l.unitPrice,
        list_price: l.listPrice,
        discount: l.discount,
        tax_rate: l.taxRate,
        tax_amount: l.taxAmount,
        line_total: l.lineTotal,
        unit_cost: 0,
        line_cost: 0,
      })));

      if (receiptReference) {
        const same = await svc.entities.FieldSale.filter({ receipt_reference: receiptReference });
        const others = same.filter((s) => s.id !== sale.id);
        if (others.length) {
          await svc.entities.FieldSale.update(sale.id, {
            duplicate_flag: true,
            duplicate_note: `Receipt reference ${receiptReference} is also used by ${others.map((o) => o.sale_number).join(', ')}`,
          });
        }
      }

      if (submit) {
        const fresh = await svc.entities.FieldSale.get(sale.id);

        if (!fresh.stock_moved_at) {
          const token = crypto.randomUUID();
          const claimed = await claimField(svc, 'FieldSale', sale.id, 'stock_moved_at', token);
          if (!claimed) throw new Error('This delivery is already being processed — refresh before submitting again');

          try {
            const costByProduct = {};
            let cost = 0;

            for (const l of lines) {
              const res = await stockIssue(svc, {
                productId: l.product.id, productName: l.product.name,
                warehouseId: run.stock_warehouse_id,
                quantity: l.qty, movementType: 'field_delivery', documentType: 'FieldSale', documentId: sale.id,
                movementDate: transactionDate, reason: `Delivered to ${customer.business_name}`, saleableOnly: true,
              });
              cost = round2(cost + res.totalValue);
              const layer = res.layers[0] || {};
              costByProduct[l.product.id] = {
                unit_cost: l.qty > 0 ? round2(res.totalValue / l.qty) : 0,
                line_cost: res.totalValue,
                lot_number: layer.lotNumber || '',
                expiry_date: layer.expiryDate || '',
              };
            }

            const savedLines = await svc.entities.FieldSaleLine.filter({ field_sale_id: sale.id });
            const updates = savedLines
              .map((sl) => {
                const c = costByProduct[sl.product_id];
                return c ? { id: sl.id, unit_cost: c.unit_cost, line_cost: c.line_cost, lot_number: c.lot_number, expiry_date: c.expiry_date || undefined } : null;
              })
              .filter(Boolean);
            for (const { id: lineId, ...values } of updates) await svc.entities.FieldSaleLine.update(lineId, values);

            await svc.entities.FieldSale.update(sale.id, {
              stock_moved_at: new Date().toISOString(),
              custodian_warehouse_id: run.stock_warehouse_id,
              pending_warehouse_id: '',
              inventory_effect: 'issued',
              cost_of_goods: cost,
            });
          } catch (e) {
            await svc.entities.FieldSale.update(sale.id, { stock_moved_at: '' });
            throw e;
          }
        }

        if (paymentType === 'cash' && cashPortion > 0) {
          const existing = await svc.entities.CashCollection.filter({ field_sale_id: sale.id });
          if (!existing.length) {
            const collectionNumber = await nextSequence(svc, 'next_collection_number', 'COL', 6);
            await svc.entities.CashCollection.create({
              collection_number: collectionNumber,
              field_sale_id: sale.id,
              sale_number: sale.sale_number,
              customer_id: customer.id,
              customer_name: customer.business_name || '',
              commercial_id: employee.id,
              commercial_name: employee.full_name,
              payment_type: 'cash',
              amount_due: total,
              amount_collected: cashPortion,
              collection_date: payload.collection_date || transactionDate,
              method: 'cash',
              reference: receiptReference,
              status: 'held_by_commercial',
              handed_over_amount: 0,
              received_amount: 0,
              outstanding_amount: cashPortion,
            });
          }
        }

        await audit(svc, {
          action: 'submit_field_sale', module: 'field_sales', entityType: 'FieldSale', entityId: sale.id,
          userId: user.id,
          description: `Submitted ${sale.sale_number} — ${customer.business_name}, ${total} XAF (${paymentType})`,
        });
        const recorded = await svc.entities.FieldSale.get(sale.id);
        const recordedLines = await svc.entities.FieldSaleLine.filter({ field_sale_id: sale.id });
        await recordSaleAccounting(svc, recorded, recordedLines, { id: user.id, name: employee.full_name || user.full_name }, true);
        await postSaleReplacements(svc, user, recorded, replacements);
      }

      return Response.json({ sale: await svc.entities.FieldSale.get(sale.id) });
    }

    if (action === 'proposedJournal') {
      const { employee, role } = await requireStaff(base44, user, ['admin', 'commercial'], 'previewing a proposed journal');
      const sale = await svc.entities.FieldSale.get(body.saleId);
      if (!sale) throw new Error('Sale not found');
      if (role !== 'admin' && sale.commercial_id !== employee?.id) throw new Error('This sale belongs to another Commercial');
      const lines = await svc.entities.FieldSaleLine.filter({ field_sale_id: sale.id });
      const plan = await buildSaleJournal(svc, sale, lines);
      return Response.json({ lines: plan, posts: sale.status === 'approved_posted' });
    }

    if (action === 'approveSale') {
      const { employee } = await requireStaff(base44, user, ['admin'], 'approving a field sale');
      const sale = await svc.entities.FieldSale.get(body.saleId);
      if (!sale) throw new Error('Sale not found');
      if (employee?.id && employee.id === sale.commercial_id) {
        throw new Error('You cannot approve a sale you submitted — a different approver is required');
      }
      if (sale.status === 'approved_posted') {
        return Response.json({ sale, alreadyPosted: true, journalId: sale.journal_id });
      }
      if (!['submitted', 'under_review', 'posting_failed'].includes(sale.status)) {
        throw new Error(`A sale that is ${sale.status} cannot be approved`);
      }
      if (!sale.stock_moved_at) throw new Error('The delivered stock has not been recorded yet — resubmit the sale first');

      const lines = await svc.entities.FieldSaleLine.filter({ field_sale_id: sale.id });
      if (!lines.length) throw new Error('This sale has no lines');

      const { journal } = await recordSaleAccounting(svc, sale, lines, { id: user.id, name: employee?.full_name || user.full_name });

      return Response.json({
        sale: await svc.entities.FieldSale.get(sale.id),
        journalId: journal.id,
        journalNumber: journal.journal_number,
      });
    }

    if (action === 'returnSale' || action === 'rejectSale') {
      const { employee } = await requireStaff(base44, user, ['admin'], 'reviewing a field sale');
      const sale = await svc.entities.FieldSale.get(body.saleId);
      if (!sale) throw new Error('Sale not found');
      if (sale.status === 'approved_posted') throw new Error('A posted sale cannot be returned or rejected — reverse it instead');
      const reason = String(body.reason || '').trim();
      if (!reason) throw new Error('A reason is required');

      const status = action === 'returnSale' ? 'returned' : 'rejected';
      await svc.entities.FieldSale.update(sale.id, {
        status,
        decided_by: employee?.full_name || user.full_name,
        decided_at: new Date().toISOString(),
        decision_reason: reason,
      });

      await audit(svc, {
        action: status === 'returned' ? 'return_field_sale' : 'reject_field_sale',
        module: 'field_sales', entityType: 'FieldSale', entityId: sale.id,
        userId: user.id, reason,
        description: `${status === 'returned' ? 'Returned for correction' : 'Rejected'} ${sale.sale_number}`,
      });

      return Response.json({
        status,
        stockNote: 'Delivered goods stay in the awaiting-approval area. They are not put back into the Commercial’s physical stock — record a documented return or an authorized exception instead.',
      });
    }

    // ------------------------------------------------------------ cash handovers

    if (action === 'submitHandover') {
      const { employee } = await commercialActor(base44, user, body.commercialId, 'submit a cash handover');
      if (!employee) throw new Error('Your login is not linked to a staff record');

      const collectionIds = (Array.isArray(body.collectionIds) ? body.collectionIds : []).filter(Boolean);
      if (!collectionIds.length) throw new Error('Select the collections being handed over');
      if (!body.cashierId) throw new Error('Select the cashier receiving the money');

      const collections = await svc.entities.CashCollection.filter({ id: { $in: collectionIds } });
      if (collections.length !== collectionIds.length) throw new Error('One of the selected collections no longer exists');

      const foreign = collections.find((c) => c.commercial_id !== employee.id);
      if (foreign) throw new Error('You can only hand over your own collections');
      const blocked = collections.find((c) => c.status === 'received' || c.status === 'cancelled' || c.handover_id);
      if (blocked) throw new Error(`Collection ${blocked.collection_number} is already settled or already inside an open handover`);

      const expected = round2(collections.reduce((s, c) => s + round2((c.amount_collected || 0) - (c.received_amount || 0)), 0));
      const offered = round2(body.offeredAmount === '' || body.offeredAmount == null ? expected : body.offeredAmount);
      if (offered <= 0) throw new Error('The amount offered for handover must be greater than zero');

      const handoverNumber = await nextSequence(svc, 'next_handover_number', 'HOV', 6);
      const handover = await svc.entities.CashHandover.create({
        handover_number: handoverNumber,
        commercial_id: employee.id,
        commercial_name: employee.full_name,
        cashier_id: body.cashierId,
        cashier_name: body.cashierName || '',
        handover_date: body.date || today(),
        expected_amount: expected,
        offered_amount: offered,
        received_amount: 0,
        variance: round2(offered - expected),
        variance_reason: '',
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        notes: body.notes || '',
        idempotency_key: body.idempotencyKey || '',
      });

      await svc.entities.CashHandoverAllocation.bulkCreate(collections.map((c) => ({
        handover_id: handover.id,
        handover_number: handoverNumber,
        collection_id: c.id,
        collection_number: c.collection_number,
        sale_number: c.sale_number || '',
        customer_name: c.customer_name || '',
        amount_allocated: round2((c.amount_collected || 0) - (c.received_amount || 0)),
        allocation_date: body.date || today(),
      })));

      await svc.entities.CashCollection.bulkUpdate(collections.map((c) => ({
        id: c.id,
        status: 'handover_submitted',
        handover_id: handover.id,
        handover_number: handoverNumber,
        handed_over_amount: round2((c.amount_collected || 0) - (c.received_amount || 0)),
      })));

      await audit(svc, {
        action: 'submit_handover', module: 'cashier', entityType: 'CashHandover', entityId: handover.id,
        userId: user.id,
        description: `${employee.full_name} handed over ${offered} XAF to ${body.cashierName || 'the cashier'} (${handoverNumber})`,
      });

      return Response.json({ handoverId: handover.id, handoverNumber, expected, offered });
    }

    return Response.json({ error: `Unknown action "${action}"` }, { status: 400 });
  } catch (error) {
    if (isTransactionConflict(error)) throw error;
    return Response.json({ error: error.message }, { status: error.status || 400 });
  }
}
