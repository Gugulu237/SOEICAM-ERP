# Centralized company inventory

When the checked central inventory policy is active, staff record sales from their own profile against one company stock pool. The General Manager can still choose the actual salesperson when entering a sale for someone else. Commercial accounts cannot select another salesperson or another agent's private records.

The displayed company stock is the company's unsold inventory, including goods physically out for delivery and tracked manually. It does not claim that every unit is physically in the factory. Handing goods to a person or bringing unsold goods back does not require a system issue or receipt in this model. Actual sales deduct approved, unexpired finished goods once at their recorded lot cost. Cash, credit, customer branches, replacements and sale reversals retain their checked workflows.

## Dégustations

Record actual promotional quantities through the Dégustation action, with the responsible employee, date, reason and optional recipient customer. A company-stock giveaway deducts inventory at its carrying value and posts Degustations expense, without revenue or COGS. Customer exchanges remain separate from giveaways.

Previously expensed promotional custody is displayed separately. Recording those units as given consumes only the protected allocation and does not expense it again. They cannot be sold or added to the saleable pool. Repeated submissions reuse the original verified record, including after an interrupted response.

## Customer ownership and commissions

New registrations save the authenticated user and the employee who registered the customer. The original acquiring employee, the registrar and the person making a later sale are separate identities. Posted sales save the acquisition beneficiary so later directory changes cannot redirect their commission.

Authorized sellers and Dégustation recorders can select any active company customer; this does not change acquisition ownership or the employee's own monthly commission portfolio.

The monthly customer commission report counts registered customers and posted net sales to each employee's acquired customers across all sellers. Tax, customer deposits, opening receivables, duplicate linked documents and unposted sales do not increase eligible turnover. Reversals reduce the commission basis on their correction date. Customer acquisition rejected as a duplicate does not earn a bonus or commission.

Employee settings provide the commission percentage and optional bonus per verified new customer. Missing rates remain **Not configured**, rather than being treated as an approved zero or an invented percentage. Amounts are estimates for review; viewing the report does not create a payroll payment or journal entry.

The General Manager can confirm an original acquisition owner for an unassigned historical customer with a reason. This preserves the historical user who recorded the customer. Existing known ownership and frozen sale attribution cannot be silently replaced. Historical registrations are backfilled only where independent staff-identity and registration evidence proves the employee at that time.

## Controlled activation

Publishing source does not enable the model or change company records. Activation requires a protected company setting, an administrator audit and a matching virtual company stock warehouse. Existing ordinary issued stock is reconciled and transferred to that book location at the same quantities and carrying values. This is explicitly a book-location transition, not a claim that goods physically returned, and creates no sale, expense, cash movement or accounting journal.

Original load manifests, sales, invoices and journal amounts remain unchanged. Each historical load discloses its separately evidenced centralized quantity during reconciliation. Expensed Dégustations and quarantined customer returns stay outside the saleable pool. Once active, old loading and top-up endpoints cannot start another issue-based flow.
# Accountant-led organization and sale attribution

Centralized sales allow the recorder to select any active registered employee, including staff without login accounts and Hotesses. The invoice and sales report retain that employee as salesperson; `recorded_by` and the immutable submission audit retain the authenticated recorder. Acquisition beneficiaries remain those recorded on the customer. Inactive or removed employees cannot receive new attribution. Legacy issued-stock forms retain their existing self-service restrictions.

The former Warehouse Keeper position is now **Accountant**, with inventory, journals, accounts, financial reports and related accounting tools. Its historical `warehouse_manager` key is retained so employee and accounting references do not change. Permissions use the existing feature-scoped grants; the position receives no General Manager identity or staff administration rights. Production assistants retain their explicit saved modules.

`scripts/central-accountant-restructure.sql` applies the requested saved-organigram change once, retires the Driver profile and removes Distribution from every saved role. It retains the original catalogue and affected employee records in audit. Delivery stock is followed manually by the Accountant. Old Distribution entry links redirect to Inventory when centralized stock is active.

The same reviewed maintenance hands Jovaln's 13 already-expensed promotional units to manual follow-up. Their zero-valued ERP custody balances close; the original quantities, lot identities and 3,848.87 XAF marketing expense remain documented. No giveaway to a named customer, physical return, saleable-stock increase or second expense is asserted. `CentralPromotionalHandoff` evidence reconciles this separate bookkeeping change in historical load reports. Maintenance is transactional and repeatable without posting twice; it is never invoked automatically at application startup.
