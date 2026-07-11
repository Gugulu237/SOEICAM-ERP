import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Central double-entry posting engine.
// Accepts a structured posting request, resolves configurable account mappings,
// validates that debits equal credits, enforces period controls and idempotency,
// creates an immutable posted journal + lines, updates cached account balances,
// and writes an audit record. Corrections must use reversal (never mutation).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      source_module, source_document_type, source_document_id,
      idempotency_key, entry_date, posting_date, description, reference,
      branch_id, currency, exchange_rate, lines, reversal_of, reversal_reason
    } = body;

    if (!lines || !Array.isArray(lines) || lines.length < 2) {
      return Response.json({ error: 'A journal requires at least two lines' }, { status: 400 });
    }

    const idemKey = idempotency_key || `${source_module || 'manual'}:${source_document_type || 'JE'}:${source_document_id || Date.now()}`;

    // Idempotency: never create a duplicate posted journal for the same source.
    const existing = await base44.entities.JournalEntry.filter({ idempotency_key: idemKey, status: 'posted' });
    if (existing && existing.length > 0) {
      return Response.json({
        journal_id: existing[0].id,
        journal_number: existing[0].journal_number,
        total_debit: existing[0].total_debit,
        total_credit: existing[0].total_credit,
        idempotent_reuse: true
      });
    }

    // Resolve configurable account mappings (keys -> account_id).
    const mappings = await base44.entities.AccountMapping.filter({});
    const mappingByKey = {};
    for (const m of mappings) mappingByKey[m.mapping_key] = m.account_id;

    // Resolve every line to a concrete account_id.
    const resolvedLines = [];
    const neededAccountIds = new Set();
    for (const l of lines) {
      let accountId = l.account_id;
      if (!accountId && l.account_key) {
        accountId = mappingByKey[l.account_key];
        if (!accountId) {
          return Response.json({ error: `No account mapping configured for key: ${l.account_key}` }, { status: 400 });
        }
      }
      if (!accountId) {
        return Response.json({ error: 'Journal line is missing account_id or account_key' }, { status: 400 });
      }
      neededAccountIds.add(accountId);
      resolvedLines.push({ ...l, account_id: accountId });
    }

    // Load referenced accounts for validation + balance update.
    const accountList = await base44.entities.Account.filter({});
    const accountById = {};
    for (const a of accountList) accountById[a.id] = a;

    // Validate each line and accumulate totals.
    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of resolvedLines) {
      const d = Math.round(Number(l.debit) || 0);
      const c = Math.round(Number(l.credit) || 0);
      if (d < 0 || c < 0) return Response.json({ error: 'Negative line values are not allowed' }, { status: 400 });
      if (d > 0 && c > 0) return Response.json({ error: 'A line cannot have both a debit and a credit' }, { status: 400 });
      if (d === 0 && c === 0) return Response.json({ error: 'Zero-value journal lines are not allowed' }, { status: 400 });
      const acc = accountById[l.account_id];
      if (!acc) return Response.json({ error: `Account not found: ${l.account_id}` }, { status: 400 });
      if (acc.is_posting === false) return Response.json({ error: `Account ${acc.account_number} is a header account (not postable)` }, { status: 400 });
      if (acc.is_active === false) return Response.json({ error: `Account ${acc.account_number} is inactive` }, { status: 400 });
      totalDebit += d;
      totalCredit += c;
    }
    if (totalDebit !== totalCredit) {
      return Response.json({ error: `Journal does not balance — debits ${totalDebit} ≠ credits ${totalCredit}` }, { status: 400 });
    }

    // Period control: block posting into closed/locked periods.
    const postDate = (posting_date || entry_date || new Date().toISOString().split('T')[0]);
    const periods = await base44.entities.AccountingPeriod.filter({});
    const period = periods.find(p => p.start_date <= postDate && p.end_date >= postDate);
    if (period && (period.status === 'closed' || period.status === 'locked')) {
      return Response.json({ error: `Accounting period ${period.name} is ${period.status} — posting blocked` }, { status: 400 });
    }

    // Sequential journal number from company settings.
    const settings = (await base44.entities.CompanySettings.filter({}))[0];
    const jNum = settings?.next_journal_number || 1;

    const journal = await base44.entities.JournalEntry.create({
      journal_number: `JE-${String(jNum).padStart(5, '0')}`,
      entry_date: entry_date || postDate,
      posting_date: postDate,
      description: description || '',
      reference: reference || '',
      source_module: source_module || 'manual',
      source_document_type: source_document_type || '',
      source_document_id: source_document_id || '',
      idempotency_key: idemKey,
      branch_id: branch_id || '',
      currency: currency || 'XAF',
      exchange_rate: Number(exchange_rate) || 1,
      status: 'posted',
      total_debit: totalDebit,
      total_credit: totalCredit,
      period_id: period?.id || '',
      posted_by: user.id,
      posted_at: new Date().toISOString(),
      reversal_of: reversal_of || '',
      reversal_reason: reversal_reason || '',
      is_immutable: true
    });

    if (settings) {
      await base44.entities.CompanySettings.update(settings.id, { next_journal_number: jNum + 1 });
    }

    // Create the balanced journal lines (bulkCreate — no per-line side effects).
    const lineCreates = resolvedLines.map(l => {
      const acc = accountById[l.account_id];
      return {
        journal_id: journal.id,
        account_id: l.account_id,
        account_number: acc.account_number,
        account_name: acc.name,
        debit: Math.round(Number(l.debit) || 0),
        credit: Math.round(Number(l.credit) || 0),
        description: l.description || '',
        branch_id: l.branch_id || branch_id || '',
        department_id: l.department_id || '',
        cost_centre: l.cost_centre || '',
        party_type: l.party_type || '',
        party_id: l.party_id || '',
        customer_id: l.party_type === 'customer' ? (l.party_id || '') : (l.customer_id || ''),
        supplier_id: l.party_type === 'supplier' ? (l.party_id || '') : (l.supplier_id || ''),
        employee_id: l.party_type === 'employee' ? (l.party_id || '') : (l.employee_id || ''),
        product_id: l.product_id || '',
        route_id: l.route_id || '',
        vehicle_id: l.vehicle_id || '',
        tax_code: l.tax_code || '',
        due_date: l.due_date || '',
        currency_amount: Number(l.currency_amount) || 0
      };
    });
    await base44.entities.JournalLine.bulkCreate(lineCreates);

    // Update cached account balances (reproducible from immutable lines).
    const deltaByAccount = {};
    for (const l of resolvedLines) {
      const acc = accountById[l.account_id];
      const d = Math.round(Number(l.debit) || 0);
      const c = Math.round(Number(l.credit) || 0);
      const normal = acc.normal_balance || 'debit';
      const delta = normal === 'debit' ? (d - c) : (c - d);
      deltaByAccount[l.account_id] = (deltaByAccount[l.account_id] || 0) + delta;
    }
    const balanceUpdates = Object.entries(deltaByAccount).map(([aid, delta]) => ({
      id: aid,
      balance: Math.round((accountById[aid].balance || 0) + delta)
    }));
    if (balanceUpdates.length > 0) {
      await base44.entities.Account.bulkUpdate(balanceUpdates);
    }

    // Link reversal target back to this reversing journal.
    if (reversal_of) {
      await base44.entities.JournalEntry.update(reversal_of, { reversed_by_journal: journal.id, status: 'reversed' });
    }

    await base44.entities.AuditLog.create({
      action: 'post_journal',
      module: 'accounting',
      entity_type: 'JournalEntry',
      entity_id: journal.id,
      user_id: user.id,
      description: `Journal ${journal.journal_number} posted — ${description || ''} (Dr ${totalDebit} / Cr ${totalCredit})${reversal_of ? ' [REVERSAL]' : ''}`
    });

    return Response.json({
      journal_id: journal.id,
      journal_number: journal.journal_number,
      total_debit: totalDebit,
      total_credit: totalCredit,
      lines_posted: resolvedLines.length
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Posting failed' }, { status: 500 });
  }
});