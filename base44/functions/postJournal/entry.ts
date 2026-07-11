import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      entry_date, description, reference = '', lines,
      source_module = 'manual', source_document_type = 'manual_journal',
      source_document_id = '', posting_type = 'manual_entry', branch_id = '',
      reversal_of = '', reversal_reason = ''
    } = body;

    // --- Validation ---
    if (!entry_date || !description) {
      return Response.json({ error: 'Entry date and description are required' }, { status: 400 });
    }
    if (!Array.isArray(lines) || lines.length < 2) {
      return Response.json({ error: 'A journal entry requires at least two lines' }, { status: 400 });
    }

    let totalDebit = 0, totalCredit = 0;
    for (const l of lines) {
      const d = round4(l.debit), c = round4(l.credit);
      if (!l.account_id) return Response.json({ error: 'Each line requires an account' }, { status: 400 });
      if (d > 0 && c > 0) return Response.json({ error: 'A line cannot have both debit and credit' }, { status: 400 });
      if (d === 0 && c === 0) return Response.json({ error: 'A line cannot have zero debit and credit' }, { status: 400 });
      totalDebit += d; totalCredit += c;
    }
    totalDebit = round4(totalDebit);
    totalCredit = round4(totalCredit);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return Response.json({ error: `Journal not balanced: debits ${totalDebit} ≠ credits ${totalCredit}` }, { status: 400 });
    }

    // --- Resolve & validate accounts ---
    const accountIds = [...new Set(lines.map(l => l.account_id))];
    const accounts = await base44.entities.Account.filter({});
    const accountMap = {};
    for (const a of accounts) accountMap[a.id] = a;
    for (const id of accountIds) {
      const a = accountMap[id];
      if (!a) return Response.json({ error: `Account not found: ${id}` }, { status: 400 });
      if (a.is_active === false) return Response.json({ error: `Account is inactive: ${a.account_number} ${a.name}` }, { status: 400 });
      if (a.is_posting === false) return Response.json({ error: `Cannot post to a header account: ${a.account_number} ${a.name}` }, { status: 400 });
    }

    // --- Idempotency ---
    if (source_document_id) {
      const existing = await base44.entities.JournalEntry.filter({
        source_module, source_document_type, source_document_id, posting_type, status: 'posted'
      });
      if (existing.length > 0) {
        return Response.json({ journal_id: existing[0].id, journal_number: existing[0].journal_number, idempotent: true });
      }
    }

    // --- Period check ---
    const periods = await base44.entities.AccountingPeriod.filter({});
    const entryDate = new Date(entry_date + 'T00:00:00Z');
    const period = periods.find(p => new Date(p.start_date + 'T00:00:00Z') <= entryDate && new Date(p.end_date + 'T00:00:00Z') >= entryDate);
    if (!period) return Response.json({ error: 'No accounting period covers this date' }, { status: 400 });
    if (period.status === 'closed' || period.status === 'locked') {
      return Response.json({ error: `Period ${period.name} is ${period.status}. Posting is not allowed.` }, { status: 400 });
    }

    // --- Generate journal number ---
    const settings = await base44.entities.CompanySettings.filter({});
    const cs = settings[0];
    let seq = (cs && cs.next_journal_number) || 1;
    const year = entryDate.getUTCFullYear();
    const journal_number = `JE-${year}-${String(seq).padStart(5, '0')}`;
    if (cs) {
      await base44.entities.CompanySettings.update(cs.id, { next_journal_number: seq + 1 });
    }

    const now = new Date().toISOString();
    const idemKey = `${source_module}|${source_document_type}|${source_document_id || ''}|${posting_type}`;

    // --- Create journal entry (posted, immutable) ---
    const je = await base44.entities.JournalEntry.create({
      journal_number,
      entry_date,
      posting_date: entry_date,
      description,
      reference,
      source_module,
      source_document_type,
      source_document_id,
      posting_type,
      idempotency_key: idemKey,
      branch_id,
      period_id: period.id,
      status: 'posted',
      is_immutable: true,
      total_debit: totalDebit,
      total_credit: totalCredit,
      currency: 'XAF',
      exchange_rate: 1,
      created_by: user.id,
      posted_by: user.full_name || user.email || '',
      posted_at: now,
      reversal_of,
      reversal_reason,
      reversed_by_journal: ''
    });

    // --- Create journal lines ---
    const lineRecords = lines.map(l => {
      const a = accountMap[l.account_id];
      return {
        journal_id: je.id,
        account_id: l.account_id,
        account_number: a.account_number,
        account_name: a.name,
        debit: round4(l.debit),
        credit: round4(l.credit),
        description: l.description || '',
        branch_id: l.branch_id || branch_id || '',
        department_id: l.department_id || '',
        cost_centre: l.cost_centre || '',
        party_type: l.party_type || '',
        party_id: l.party_id || '',
        party_name: l.party_name || '',
        customer_id: l.customer_id || '',
        supplier_id: l.supplier_id || '',
        employee_id: l.employee_id || '',
        product_id: l.product_id || '',
        route_id: l.route_id || '',
        vehicle_id: l.vehicle_id || '',
        tax_code: l.tax_code || '',
        due_date: l.due_date || ''
      };
    });
    await base44.entities.JournalLine.bulkCreate(lineRecords);

    // --- Update account balances (cached; ledger is source of truth) ---
    for (const l of lines) {
      const a = accountMap[l.account_id];
      const d = round4(l.debit), c = round4(l.credit);
      let bal = a.balance || 0;
      if (a.normal_balance === 'debit') bal += (d - c);
      else bal += (c - d);
      await base44.entities.Account.update(a.id, { balance: round4(bal) });
      accountMap[a.id].balance = round4(bal);
    }

    // --- Mark original as reversed ---
    if (reversal_of) {
      await base44.entities.JournalEntry.update(reversal_of, { reversed_by_journal: je.id, status: 'reversed' });
    }

    // --- Audit log (best-effort; must not block a successful post) ---
    try {
      await base44.entities.AuditLog.create({
        action: reversal_of ? 'journal_reversed' : 'journal_posted',
        module: 'accounting',
        entity_type: 'JournalEntry',
        entity_id: je.id,
        user_id: user.id,
        user_name: user.full_name || user.email || '',
        description: `${journal_number}: ${description} (Dr ${totalDebit} / Cr ${totalCredit})${reversal_of ? ' [REVERSAL]' : ''}`,
        new_value: `status=posted, lines=${lineRecords.length}`
      });
    } catch (_auditErr) { /* audit failure must not roll back the financial post */ }

    return Response.json({ journal_id: je.id, journal_number, total_debit: totalDebit, total_credit: totalCredit, lines: lineRecords.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});