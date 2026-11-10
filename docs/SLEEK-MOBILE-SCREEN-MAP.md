# SOEICAM mobile screens

See the [layout audit and remaining differences](SLEEK-MOBILE-FIDELITY-AUDIT.md). This route map identifies screen destinations; it is not a claim of exact visual synchronization.

Implementation reference: the 40 components in `export-react.zip`, exported from [SOEICAM ERP Mobile](https://sleek.design/project/UXViqxJgxPf).

The exported screen structures are connected to existing ERP records and checked operations. The later approved white SOEICAM theme and company logo take precedence over the cream palette and YOLA text in the export. These are phone layouts; desktop tools remain available.

`<id>` means select a real record in the preceding list. Screens shown as steps, dialogs or details are states of the same workflow, rather than independent duplicate pages.

| # | Exported screen | Where to open it on a phone | Implementation |
|---|---|---|---|
| 1 | Connexion | `/login` | Branded sign-in layout; configured Clerk/Supabase form and recovery |
| 2 | Accueil GM | `/` as GM | Actual daily sales/profit, receivables, modules and stock/approval alerts |
| 3 | Accueil Commercial | `/commercial` or the Commercial home | Primary sale/customer actions, personal metrics, acquired customers and recent sales |
| 4 | Accueil Comptable | `/` as Accountant | Stock, posted profit, payables, receivables, six modules and pending tasks |
| 5 | Accueil Production | `/` as Production Manager | Assemblies, monthly batches/output, material availability and recent lots |
| 6 | Accueil Caissier | `/` as Cashier | Receive/petty cash, expected/confirmed cash, handovers and quick reports |
| 7 | Accueil Hôtesse | `/` as Hôtesse | Assigned customers, visits, reports and map; no sale action |
| 8 | Ventes | `/sales?tab=all` | Search, period/type filters, summaries and receipt rows; full reports retained |
| 9 | Nouvelle vente 1/3 | `/sales/new`, first step | Customer/branch, date and authorized salesperson selection |
| 10 | Nouvelle vente 2/3 | Same workflow, Products step | Inline products/quantities, replacements, prices and discounts |
| 11 | Nouvelle vente 3/3 | Same workflow, Review step | Review, payment, receipt reference and checked confirmation |
| 12 | Détail vente | Select sale or invoice; `/sales/<id>` or `/sales/invoices/<id>` | Customer, items, totals, tracking and existing document tools |
| 13 | Clients | `/customers` | Searchable directory, neighbourhoods, owner/debt, branches and map/add actions |
| 14 | Fiche client | Select customer; `/customers?view=list&customer=<id>` | Metrics, contact, GPS, acquisition owner, branches and recent sales |
| 15 | Nouveau client | `/customers/new`; edit from customer details | Main/branch, identity, zone/GPS, acquisition, billing and save |
| 16 | Carte clients | `/customers?view=map` | Zone chips, live map and selected-customer/location sheet |
| 17 | Dégustations et échanges | `/sales?tab=promotions` | GM read-only All employees history, employee/customer/period filters; restricted staff retain their own scope; checked entry forms remain separate |
| 18 | Stock | `/inventory` | Category/type filters, physical quantities and recorded batch expiry, compact rows and item details; packaging has no expiry warnings; no per-item Receive/Count controls |
| 19 | Fiche article | `/items/<id>` | Item details, pricing, lots/movements and complete settings |
| 20 | Réception stock | Purchases → Receiving → approved order | Order/warehouse, received quantities, batch/expiry and receipt value |
| 21 | Inventaire et ajustement | Accounting → Quantity adjustments; `/accounting/inventory?view=adjustments` | Adjustment history and the existing guarded Adjust quantity form with item selection |
| 22 | Alertes péremption | `/expiry` or Production → Quality → Expiry | All/near/expired/held cards and stock-alert access |
| 23 | Assemblages | `/manufacturing?section=assemblies`; default phone Manufacturing | Searchable assembly catalogue by type/size |
| 24 | Fiche assemblage | Select assembly; `?section=assemblies&assembly=<id>` | Saved yield helper, material/other-component totals, packaging totals, complete cost and checked produce action |
| 25 | Enregistrer production | `/manufacturing?section=build` | Grouped outputs, saved yield/buckets, quantity/expiry, component review and post |
| 26 | Lot production | Select saved build or `/traceability?batch=<batch>&product=<id>` | Actual lot details, movement timeline, materials and traceability |
| 27 | Comptabilité | `/accounting` | Posted financial summary, quick access and actual recurring queue |
| 28 | Nouvelle dépense | `/expenses?tab=register&new=expense` | Paid expense form; links to existing planned/unpaid/recurring workflows |
| 29 | Charges récurrentes | `/accounting/recurring-expenses` | Month/unpaid summaries and accrual/payment controls |
| 30 | Plan comptable | `/accounting?tab=accounts` | Account hierarchy, filters, balances and existing edit/actions |
| 31 | Journal comptable | `/accounting?tab=journals`; New Journal | Source filters, compact journal register and full existing journal form |
| 32 | Rapports financiers | `/accounting/statements` | Actual revenue/margin/net summary, statements and exports |
| 33 | Immobilisations | `/accounting/assets` | Cost, life, monthly charge, accumulated depreciation, net value and actions |
| 34 | Achats | `/purchases` | Debt/orders/payment summary, module grid, open orders and new order |
| 35 | Commande fournisseur | Select/create order in Purchases → Orders | Status/lifecycle and ordered/received/value item cards |
| 36 | Fournisseur et règlement | Purchases → Suppliers → select supplier | Balance, combined bill/posted-advance/payment timeline, existing payment account and approval form |
| 37 | Caisse | `/cashier` | Inline checked handover/daily-cash confirmation with live variance, treasury/date and retry protection; petty cash, top-ups and other cash sections |
| 38 | Équipe et profil | `/employees/<id>` via Team | Contact/status, actual monthly acquisition performance/commissions, payroll and edit |
| 39 | Paie | `/team-workspaces?section=payroll` | Run summary, employee payslip cards, adjustments, review/payment and history |
| 40 | Plus | Bottom More; `/profile?section=more` | Real profile edit, language/device preferences, role access, modules and sign out |

## Access and data

Staff homes follow the assigned account role. The GM can review employee dashboards under Team → Reports, using the existing read-only management mode. Feature links retain their role/module restrictions; this design update does not grant extra access.

All amounts, names, quantities, histories and permissions come from the ERP. Sample values and employee portraits from the export are not imported as company data.

## Business-rule adaptations

- Sign-in and recovery remain controlled by the configured identity provider; the design does not replace authentication or impose the export's illustrative reset-link lifetime.
- Production uses the ERP's generated batch identifiers, displayed truthfully; the export's editable batch-name example does not override that rule.
- Receiving still requires an approved purchase order. Packaging retains its existing no-expiry behavior.
- Dégustation uses its existing separate atomic confirmation; it is not silently included in a sale write.
- Supplier balances and credits use the posted ledger. Payment approval/release remains required; no unchecked advance-application operation is added.
- Paid petty-cash expenses, planned expense requests and recurring charges remain distinct checked workflows.
- GM profit is explicitly the posted daily ledger result. Employee commission values are estimates from the verified acquisition report, subject to management review; they are not automatic salary payments.
