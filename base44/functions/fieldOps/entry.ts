import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import {
  round2, round3, today, requireStaff, getRuleAccount, getAccountByNumber,
  nextSequence, postJournal, stockTransfer, getCustodyWarehouse, getPendingWarehouse,
  claimField, audit,
} from '../../shared/field-ops.ts';

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
  const revenue = await getRuleAccount(client, 'sales_revenue');
  const receivable = await getRuleAccount(client, 'customer_receivable');
  const taxPayable = await getRuleAccount(client, 'tax_payable');
  const cogsAccount = await getRuleAccount(client, 'direct_material_cogs');
  const inventory = await getRuleAccount(client, 'finished_goods_inventory');
  // Cash collected in the field is company money held by the Commercial, not yet
  // in a treasury account: it clears through the cash-in-transit account.
  const clearing = await getAccountByNumber(client, '1050');

  const total = round2(sale.total);
  const net = round2(sale.subtotal);
  const tax = round2(sale.tax_total);
  const cost = round2(sale.cost_of_goods);
  const debitSide = sale.payment_type === 'cash' ? clearing : receivable;

  const plan = [
    {
      account_id: debitSide.id, account_number: debitSide.account_number, account_name: debitSide.account_name,
      debit: total, credit: 0,
      description: sale.payment_type === 'cash'
        ? `Cash in transit — collected by ${sale.commercial_name}`
        : `Receivable — ${sale.customer_name}`,
      party_type: 'customer', party_id: sale.customer_id,
    },
    {
      account_id: revenue.id, account_number: revenue.account_number, account_name: revenue.account_name,
      debit: 0, credit: net, description: `Field sale ${sale.sale_number}`,
    },
  ];

  if (tax > 0) {
    plan.push({
      account_id: taxPayable.id, account_number: taxPayable.account_number, account_name: taxPayable.account_name,
      debit: 0, credit: tax, description: `Tax on ${sale.sale_number}`,
    });
  }

  if (cost > 0) {
    plan.push({
      account_id: cogsAccount.id, account_number: cogsAccount.account_number, account_name: cogsAccount.account_name,
      debit: cost, credit: 0, description: `Cost of goods delivered — ${sale.sale_number}`,
    });
    plan.push({
      account_id: inventory.id, account_number: inventory.account_number, account_name: inventory.account_name,
      debit: 0, credit: cost, description: `Inventory released — ${sale.sale_number}`,
    });
  }

  return plan;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // The user-scoped client authenticates the caller; protected writes run with
    // the service role only after the role has been checked below.
    const svc = base44.asServiceRole;

    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!action) return Response.json({ error: 'An action is required' }, { status: 400 });

    // ---------------------------------------------------------------- custody

    if (action === 'issueCustody') {
      const { employee } = await requireStaff(base44, user, ['admin', 'warehouse_manager'], 'issuing stock into a Commercial’s custody');
      const { commercialId, sourceWarehouseId, date, reference, notes } = body;
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!commercialId) throw new Error('Select the Commercial receiving the goods');
      if (!sourceWarehouseId) throw new Error('Select the source warehouse');
      if (!lines.length) throw new Error('Add at least one product to issue');

      const commercial = await svc.entities.Employee.get(commercialId);
      if (!commercial) throw new Error('The selected Commercial was not found');
      const source = await svc.entities.Warehouse.get(sourceWarehouseId);
      if (!source) throw new Error('The source warehouse was not found');
      if (['commercial_custody', 'field_delivery_pending'].includes(source.warehouse_type)) {
        throw new Error('Goods can only be issued from a storage location, not from custody or a pending-delivery area');
      }

      const custody = await getCustodyWarehouse(svc, commercial.id, commercial.full_name);
      const issueRef = String(reference || '').trim() || `CI-${Date.now().toString(36).toUpperCase()}`;
      const issueDate = date || today();
      const moved = [];

      for (const line of lines) {
        const qty = round3(line.quantity);
        if (qty <= 0) continue;
        const product = await svc.entities.Product.get(line.product_id);
        if (!product) throw new Error('A selected product no longer exists');
        const res = await stockTransfer(svc, {
          productId: product.id, productName: product.name,
          fromWarehouseId: source.id, toWarehouseId: custody.id, toWarehouseName: custody.name,
          quantity: qty, movementType: 'commercial_issue', documentType: 'CustodyIssue', documentId: issueRef,
          movementDate: issueDate, reason: notes || `Issued to ${commercial.full_name}`, saleableOnly: true,
        });
        moved.push({
          product_id: product.id, product_name: product.name, quantity: qty,
          total_cost: res.totalValue, unit_cost: qty > 0 ? round2(res.totalValue / qty) : 0,
        });
      }
      if (!moved.length) throw new Error('Every line had a zero quantity — nothing was issued');

      await audit(svc, {
        action: 'issue_custody', module: 'custody', entityType: 'Warehouse', entityId: custody.id,
        userId: employee?.id || user.id,
        description: `Issued ${moved.length} product(s) to ${commercial.full_name} from ${source.name} (${issueRef})`,
      });

      return Response.json({ custodyWarehouseId: custody.id, custodyWarehouseName: custody.name, issueRef, moved });
    }

    if (action === 'returnCustody') {
      const { employee } = await requireStaff(base44, user, ['admin', 'warehouse_manager'], 'recording a return from a Commercial');
      const { commercialId, toWarehouseId, date, reason } = body;
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!commercialId) throw new Error('Select the Commercial returning the goods');
      if (!toWarehouseId) throw new Error('Select the warehouse receiving the return');
      if (!lines.length) throw new Error('Add at least one product to return');

      const commercial = await svc.entities.Employee.get(commercialId);
      if (!commercial) throw new Error('The selected Commercial was not found');
      const destination = await svc.entities.Warehouse.get(toWarehouseId);
      if (!destination) throw new Error('The destination warehouse was not found');
      const custody = await getCustodyWarehouse(svc, commercial.id, commercial.full_name);
      const returnRef = `CR-${Date.now().toString(36).toUpperCase()}`;
      const returnDate = date || today();
      const moved = [];

      for (const line of lines) {
        const qty = round3(line.quantity);
        if (qty <= 0) continue;
        const product = await svc.entities.Product.get(line.product_id);
        if (!product) throw new Error('A selected product no longer exists');
        const res = await stockTransfer(svc, {
          productId: product.id, productName: product.name,
          fromWarehouseId: custody.id, toWarehouseId: destination.id, toWarehouseName: destination.name,
          quantity: qty, movementType: 'commercial_return', documentType: 'CustodyReturn', documentId: returnRef,
          movementDate: returnDate, reason: reason || `Returned by ${commercial.full_name}`,
        });
        moved.push({ product_id: product.id, product_name: product.name, quantity: qty, total_cost: res.totalValue });
      }
      if (!moved.length) throw new Error('Every line had a zero quantity — nothing was returned');

      await audit(svc, {
        action: 'return_custody', module: 'custody', entityType: 'Warehouse', entityId: custody.id,
        userId: employee?.id || user.id,
        description: `Recorded a return from ${commercial.full_name} into ${destination.name} (${returnRef})`,
      });

      return Response.json({ returnRef, moved });
    }

    // ------------------------------------------------------------- field sales

    if (action === 'saveSale') {
      const { employee, role } = await requireStaff(base44, user, ['admin', 'commercial'], 'recording a field sale');
      if (!employee) throw new Error('Your login is not linked to a staff record — ask an administrator to link it');

      const submit = !!body.submit;
      const transactionDate = body.transactionDate || today();
      const paymentType = body.paymentType === 'credit' ? 'credit' : 'cash';
      if (!body.customerId) throw new Error('Select the customer being supplied');

      const customer = await svc.entities.Customer.get(body.customerId);
      if (!customer) throw new Error('Customer not found');
      const location = body.locationId ? await svc.entities.CustomerLocation.get(body.locationId) : null;

      const inputLines = (Array.isArray(body.lines) ? body.lines : []).filter((l) => l.product_id && round3(l.quantity) > 0);
      if (!inputLines.length) throw new Error('Add at least one product with a quantity');
      const products = await loadProducts(svc, inputLines.map((l) => l.product_id));

      const lines = [];
      let subtotal = 0;
      let discountTotal = 0;
      let taxTotal = 0;

      for (const l of inputLines) {
        const product = products[l.product_id];
        if (!product) throw new Error('A selected product no longer exists');
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

      const cashPortion = paymentType === 'cash'
        ? round2(body.amountCollected === '' || body.amountCollected == null ? total : body.amountCollected)
        : 0;
      if (cashPortion > total + 0.01) throw new Error('The amount collected cannot exceed the sale total');
      const amountDue = round2(total - cashPortion);

      const receiptUris = (Array.isArray(body.receiptFileUris) ? body.receiptFileUris : []).filter(Boolean);
      const receiptReference = String(body.receiptReference || '').trim();
      if (submit) {
        if (!receiptUris.length) throw new Error('A readable photograph or scan of the receipt is required before submitting for approval');
        if (!receiptReference) throw new Error('The receipt reference is required before submitting for approval');
      }

      let sale = body.saleId ? await svc.entities.FieldSale.get(body.saleId) : null;
      if (sale && sale.commercial_id !== employee.id && role !== 'admin') throw new Error('This sale belongs to another Commercial');
      if (sale && sale.status === 'approved_posted') throw new Error('An approved sale is locked — correct it with a reversal or credit note');

      const terms = Number(body.paymentTermsDays) || Number(customer.payment_terms_days) || 0;
      const payload = {
        commercial_id: employee.id,
        commercial_name: employee.full_name,
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
        due_date: paymentType === 'credit' ? addDays(transactionDate, terms) : '',
        receipt_reference: receiptReference,
        receipt_file_uris: receiptUris,
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
        unit: l.product.sales_unit || l.product.storage_unit || '',
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
            const custody = await getCustodyWarehouse(svc, employee.id, employee.full_name);
            const pending = await getPendingWarehouse(svc);
            const costByProduct = {};
            let cost = 0;

            for (const l of lines) {
              const res = await stockTransfer(svc, {
                productId: l.product.id, productName: l.product.name,
                fromWarehouseId: custody.id, toWarehouseId: pending.id, toWarehouseName: pending.name,
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
            if (updates.length) await svc.entities.FieldSaleLine.bulkUpdate(updates);

            await svc.entities.FieldSale.update(sale.id, {
              stock_moved_at: new Date().toISOString(),
              custodian_warehouse_id: custody.id,
              pending_warehouse_id: pending.id,
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
          userId: employee.id,
          description: `Submitted ${sale.sale_number} — ${customer.business_name}, ${total} XAF (${paymentType})`,
        });
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

      let journal;
      try {
        const plan = await buildSaleJournal(svc, sale, lines);
        const result = await postJournal(svc, {
          entryDate: sale.transaction_date,
          description: `Field sale ${sale.sale_number} — ${sale.customer_name} (${sale.commercial_name})`,
          sourceModule: 'field_sales',
          sourceDocumentType: 'FieldSale',
          sourceDocumentId: sale.id,
          userId: employee?.id || user.id,
          lines: plan,
        });
        journal = result.journal;
      } catch (e) {
        await svc.entities.FieldSale.update(sale.id, { status: 'posting_failed', posting_error: e.message });
        throw new Error(`Posting failed: ${e.message}. The sale is held as a recoverable exception — fix the cause and approve again.`);
      }

      await svc.entities.FieldSale.update(sale.id, {
        status: 'approved_posted',
        journal_id: journal.id,
        journal_number: journal.journal_number || '',
        approved_by: employee?.full_name || user.full_name,
        approved_at: new Date().toISOString(),
        posting_error: '',
      });

      // A credit sale puts the customer's account in debt. A cash sale does not:
      // the money is tracked as cash in transit until the cashier receives it.
      if (sale.payment_type === 'credit') {
        const customer = await svc.entities.Customer.get(sale.customer_id);
        if (customer) {
          await svc.entities.Customer.update(customer.id, {
            balance: round2((customer.balance || 0) + round2(sale.total)),
          });
        }
      }

      await audit(svc, {
        action: 'approve_field_sale', module: 'field_sales', entityType: 'FieldSale', entityId: sale.id,
        userId: employee?.id || user.id,
        description: `Approved and posted ${sale.sale_number} (${journal.journal_number}) — ${sale.total} XAF`,
      });

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
        userId: employee?.id || user.id, reason,
        description: `${status === 'returned' ? 'Returned for correction' : 'Rejected'} ${sale.sale_number}`,
      });

      return Response.json({
        status,
        stockNote: 'Delivered goods stay in the awaiting-approval area. They are not put back into the Commercial’s physical stock — record a documented return or an authorized exception instead.',
      });
    }

    // ------------------------------------------------------------ cash handovers

    if (action === 'submitHandover') {
      const { employee } = await requireStaff(base44, user, ['admin', 'commercial'], 'submitting a cash handover');
      if (!employee) throw new Error('Your login is not linked to a staff record');

      const collectionIds = (Array.isArray(body.collectionIds) ? body.collectionIds : []).filter(Boolean);
      if (!collectionIds.length) throw new Error('Select the collections being handed over');
      if (!body.cashierId) throw new Error('Select the cashier receiving the money');

      const collections = await svc.entities.CashCollection.filter({ id: { $in: collectionIds } });
      if (collections.length !== collectionIds.length) throw new Error('One of the selected collections no longer exists');

      const foreign = collections.find((c) => c.commercial_id !== employee.id && user.role !== 'admin');
      if (foreign) throw new Error('You can only hand over your own collections');
      const blocked = collections.find((c) => c.status === 'received' || c.status === 'cancelled' || (c.handover_id && c.status === 'handover_submitted'));
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
        userId: employee.id,
        description: `${employee.full_name} handed over ${offered} XAF to ${body.cashierName || 'the cashier'} (${handoverNumber})`,
      });

      return Response.json({ handoverId: handover.id, handoverNumber, expected, offered });
    }

    if (action === 'confirmHandover') {
      const { employee } = await requireStaff(base44, user, ['admin', 'cashier'], 'confirming cash received');
      const handover = await svc.entities.CashHandover.get(body.handoverId);
      if (!handover) throw new Error('Handover not found');
      if (employee?.id && employee.id === handover.commercial_id) {
        throw new Error('The Commercial cannot confirm receipt of their own handover — a cashier must confirm it');
      }
      if (handover.status === 'received') return Response.json({ handover, alreadyReceived: true });

      const treasury = await svc.entities.TreasuryAccount.get(body.treasuryAccountId);
      if (!treasury) throw new Error('Select the account the money is being received into');
      const received = round2(body.receivedAmount);
      if (received < 0) throw new Error('The amount received cannot be negative');

      const token = crypto.randomUUID();
      const claimed = await claimField(svc, 'CashHandover', handover.id, 'acknowledgement_reference', token);
      if (!claimed) throw new Error('This handover is already being processed — refresh to see its current status');

      try {
        const allocations = await svc.entities.CashHandoverAllocation.filter({ handover_id: handover.id });
        const collections = await svc.entities.CashCollection.filter({ id: { $in: allocations.map((a) => a.collection_id) } });
        const byId = {};
        collections.forEach((c) => { byId[c.id] = c; });

        let left = received;
        let allocated = 0;
        for (const alloc of allocations) {
          const c = byId[alloc.collection_id];
          if (!c || left <= 0) continue;
          const outstanding = round2((c.amount_collected || 0) - (c.received_amount || 0));
          const take = round2(Math.min(outstanding, left));
          if (take <= 0) continue;
          const newReceived = round2((c.received_amount || 0) + take);
          const newOutstanding = round2((c.amount_collected || 0) - newReceived);
          await svc.entities.CashCollection.update(c.id, {
            received_amount: newReceived,
            outstanding_amount: newOutstanding,
            status: newOutstanding <= 0.01 ? 'received' : 'partially_received',
            treasury_account_id: treasury.id,
            treasury_account_name: treasury.name,
            received_by: employee?.full_name || user.full_name,
            received_at: new Date().toISOString(),
          });
          left = round2(left - take);
          allocated = round2(allocated + take);
        }

        let journal = null;
        if (allocated > 0) {
          const clearing = await getAccountByNumber(svc, '1050');
          const result = await postJournal(svc, {
            entryDate: handover.handover_date || today(),
            description: `Cash handover ${handover.handover_number} received from ${handover.commercial_name}`,
            sourceModule: 'cashier',
            sourceDocumentType: 'CashHandover',
            sourceDocumentId: handover.id,
            userId: employee?.id || user.id,
            lines: [
              {
                account_id: treasury.gl_account_id, account_number: treasury.gl_account_number, account_name: treasury.gl_account_name,
                debit: allocated, credit: 0, description: `Cash received into ${treasury.name}`,
              },
              {
                account_id: clearing.id, account_number: clearing.account_number, account_name: clearing.account_name,
                debit: 0, credit: allocated, description: 'Cash in transit cleared',
              },
            ],
          });
          journal = result.journal;
          await svc.entities.TreasuryAccount.update(treasury.id, { balance: round2((treasury.balance || 0) + allocated) });
        }

        const acknowledgement = `ACK-${String(handover.handover_number || '').replace(/\W/g, '')}-${Date.now().toString(36).toUpperCase()}`;
        const totalReceived = round2((handover.received_amount || 0) + allocated);
        const expected = round2(handover.expected_amount || 0);
        const outstanding = round2(expected - totalReceived);
        const status = body.disputed ? 'disputed' : (outstanding <= 0.01 ? 'received' : 'partially_received');

        await svc.entities.CashHandover.update(handover.id, {
          received_amount: totalReceived,
          status,
          variance: round2(totalReceived - expected),
          variance_reason: body.varianceReason || handover.variance_reason || '',
          cashier_id: employee?.id || handover.cashier_id,
          cashier_name: employee?.full_name || handover.cashier_name,
          confirmed_at: new Date().toISOString(),
          acknowledgement_reference: acknowledgement,
          treasury_account_id: treasury.id,
          treasury_account_name: treasury.name,
          journal_id: journal?.id || '',
          journal_number: journal?.journal_number || '',
        });

        await audit(svc, {
          action: 'confirm_handover', module: 'cashier', entityType: 'CashHandover', entityId: handover.id,
          userId: employee?.id || user.id,
          description: `${employee?.full_name || user.full_name} received ${allocated} XAF of ${handover.handover_number} into ${treasury.name} (${acknowledgement})`,
        });

        return Response.json({
          status,
          acknowledgementReference: acknowledgement,
          received: allocated,
          outstandingAgainstCommercial: outstanding,
          journalNumber: journal?.journal_number || '',
        });
      } catch (e) {
        await svc.entities.CashHandover.update(handover.id, { acknowledgement_reference: '' });
        throw e;
      }
    }

    return Response.json({ error: `Unknown action "${action}"` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}