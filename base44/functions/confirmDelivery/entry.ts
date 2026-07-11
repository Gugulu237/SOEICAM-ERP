import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { sales_order_id, payment_type, cash_collected, confirmation_image_url, delivered_lines, notes } = body;
    if (!sales_order_id) return Response.json({ error: 'sales_order_id is required' }, { status: 400 });

    const order = await base44.entities.SalesOrder.get(sales_order_id);
    if (!order) return Response.json({ error: 'Sales order not found' }, { status: 404 });

    const lines = await base44.entities.SalesOrderLine.filter({ order_id: sales_order_id });

    // 1. Update delivered quantities on each line
    const lineUpdates = [];
    for (const line of lines) {
      const dl = (delivered_lines || []).find((d) => d.line_id === line.id);
      const deliveredQty = dl ? Number(dl.delivered_qty) : Number(line.quantity);
      if (deliveredQty > 0) {
        lineUpdates.push(base44.entities.SalesOrderLine.update(line.id, { delivered_quantity: deliveredQty }));
      }
    }
    await Promise.all(lineUpdates);

    const now = new Date().toISOString();
    const today = now.split('T')[0];
    const isCredit = (payment_type || order.payment_type) === 'credit';

    // 2. Mark the sales order as delivered
    await base44.entities.SalesOrder.update(sales_order_id, {
      status: 'delivered',
      delivered_at: now,
      delivered_by: user.id,
      delivery_confirmation_url: confirmation_image_url || '',
      delivery_notes: notes || '',
      cash_collected: Number(cash_collected) || 0,
      payment_type: payment_type || order.payment_type,
    });

    // 3. Generate the invoice (confirmed delivery = sale)
    const settings = (await base44.entities.CompanySettings.filter({}))[0] || {};
    const invNum = settings.next_invoice_number || 1;
    const invoice = await base44.entities.Invoice.create({
      invoice_number: `INV-${String(invNum).padStart(5, '0')}`,
      customer_id: order.customer_id,
      customer_name: order.customer_name,
      sales_order_id: sales_order_id,
      invoice_date: today,
      due_date: today,
      status: isCredit ? 'posted' : 'paid',
      subtotal: order.subtotal || 0,
      tax_total: order.tax_total || 0,
      total: order.total || 0,
      amount_paid: isCredit ? 0 : (order.total || 0),
      balance: isCredit ? (order.total || 0) : 0,
      notes: `Auto-generated from delivery confirmation by ${user.full_name || user.email}`,
    });
    if (settings.id) {
      await base44.entities.CompanySettings.update(settings.id, { next_invoice_number: invNum + 1 });
    }

    // 4. Update customer balance for credit sales
    if (isCredit && order.customer_id) {
      const customer = await base44.entities.Customer.get(order.customer_id);
      if (customer) {
        await base44.entities.Customer.update(order.customer_id, {
          balance: (customer.balance || 0) + (order.total || 0),
        });
      }
    }

    // 5. Record stock movements (customer_delivery) for each delivered line
    const movements = [];
    for (const line of lines) {
      const dl = (delivered_lines || []).find((d) => d.line_id === line.id);
      const qty = dl ? Number(dl.delivered_qty) : Number(line.quantity);
      if (qty > 0) {
        movements.push(base44.entities.StockMovement.create({
          product_id: line.product_id,
          product_name: line.product_name,
          quantity: qty,
          movement_type: 'customer_delivery',
          source_warehouse_id: order.warehouse_id,
          document_type: 'sales_order',
          document_id: sales_order_id,
          movement_date: today,
          unit_cost: line.unit_cost || 0,
          total_value: (line.unit_cost || 0) * qty,
          reason: `Delivery confirmed by ${user.full_name || user.email}`,
        }));
      }
    }
    await Promise.all(movements);

    // 6. Audit trail
    await base44.entities.AuditLog.create({
      action: 'confirm_delivery',
      module: 'driver_portal',
      entity_type: 'SalesOrder',
      entity_id: sales_order_id,
      user_id: user.id,
      description: `Delivery confirmed for ${order.order_number || sales_order_id}. Payment: ${payment_type}. Invoice ${invoice.invoice_number} created.`,
    });

    return Response.json({ success: true, invoice_id: invoice.id, invoice_number: invoice.invoice_number });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});