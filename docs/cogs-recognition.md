# Cost of goods sold and unsold inventory

Manufacturing capitalizes material and conversion costs into work in progress and finished inventory. Loading goods into a vehicle or employee custody transfers the existing inventory value; it does not recognize a sale or COGS. A sale releases the carrying value of the quantities actually delivered. Remaining inventory retains its carrying value until another supported event occurs.

Field-sale previews, approvals and retries reconcile product quantities and recorded costs to approved customer-delivery movements. Held stock, manufacturing materials, vehicle loads, promotional samples and replacement issues cannot support a paid-product COGS posting. Posted retries verify the original journal without rebuilding its historical cash or revenue lines from current settings.

Free customer replacements debit the dedicated `customer_replacement_expense` mapping and credit the product's inventory asset account at actual carrying cost. When no mapping exists, the checked transaction provisions the `CUSTOMER-REPLACEMENTS` expense account. Invalid or duplicate mappings block posting. Degustation retains its separate expense workflow.

Inventory shortages, value write-downs and expired-product disposals use expense or other-expense accounts. COGS is excluded from those account choices and rejected by the server. Counts already approved with a COGS loss mapping need a recount, corrected expense mapping and independent approval; deployment does not rewrite their approval history.

A cancelled sale whose goods have not returned reverses the sale and moves its original COGS into the `unreturned_goods_expense` mapping. The checked transaction can provision `UNRETURNED-GOODS`. This does not invent a stock return or increase inventory assets. A physical return continues to restore the original issue layers into quarantine and reverse COGS. The preview binds account configuration and requires explicit acknowledgment of the reviewed cost treatment. Carrying costs and expense-account details remain restricted to management accounting roles.

Financial statements continue to reconcile to the posted ledger, including dated returns, reversals and sold-lot rounding corrections. Filtering reports to invoice sources alone would hide genuine corrections and break the ledger reconciliation.

Historical valuation errors require separate evidence. A sale can consume the correct quantity yet carry the wrong cost because an opening lot was entered incorrectly. Reconstruct the original receipt and subsequent issues before adjusting it; a later batch's manufacturing cost is not automatically the opening batch's cost. For a fully sold opening lot, correct the original opening clearing/equity and COGS together rather than debiting an inventory asset for nonexistent remaining goods. Preserve the original records and append the supported correction with an audit trail.
