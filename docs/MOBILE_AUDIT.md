# SOEICAM mobile audit — 24 October 2026

The local application has received a mobile layout and responsiveness pass, together with customer deletion from the edit screen. This report records the scope and practical limits of the review.

## Customer removal

The General Manager can open **Customers → customer → Edit → Delete customer**. A reason and explicit confirmation are required. **Deleted customers** in the customer-view selector provides restoration.

Removal is reversible and retains sales, receipts, acquisition attribution and accounting history. Outstanding debit or credit balances, open sales documents and remaining branches must be resolved first. Previously active delivery locations are disabled with the customer and restored with it. The server checks permissions, record revision and a unique confirmation key inside a transaction. Generic record endpoints cannot forge removal metadata or edit a removed customer.

No actual customer was deleted during verification. Removal, restoration, errors and retries were tested with isolated fixtures.

## Findings and fixes

| Area | Change |
| --- | --- |
| Workspace startup | Load the authenticated server profile independently of the client sign-in widget, preventing an unavailable widget from leaving a verified session on an endless spinner. |
| Background refresh | Deduplicate profile reads, avoid invalidating unchanged account data, and retain current input during temporary refresh failures. Expired or forbidden sessions still lose access. |
| Read requests | Add bounded timeouts to profile, batched entity and read-only function requests. Financial and stock writes do not acquire automatic retries. |
| Page layout | Constrain grid children, wrap headings/actions, stack tablet headers and retain normal page scrolling. |
| Touch controls | Enlarge common controls, keep phone form text at 16 px, and constrain tabs, dropdowns and dialogs to the available screen. |
| Record lists | Render one phone card layout with search, sorting, pagination, exports, selection and explicit record-opening controls. |
| Editable tables | Stack sales, journal, recipe, production, stock adjustment, inventory count, supplier order, dispatch and payment-allocation cells on phones. Retain their original callbacks and values. |
| Financial tables | Keep deliberate horizontal scrolling for comparative statements and correct mobile journal total alignment. |
| Search | Fit the list within short screens, add accessible dialog/input names and refresh current records when search reopens. |
| Customers | Make explorer rows accessible buttons, show the selected customer directly on phones, associate edit labels with controls and exclude removed customers from active directories/search. |
| Navigation | Retain the mobile drawer until the selected route commits, preserve Back/Forward state and correct the cockpit's expense shortcut. |
| Local preview | Preserve the selected route and device sizes in the preview URL; offer phone widths 320–430 px and tablet widths 768–1024 px, with a Fit screen toggle that scales the canvas while retaining the real device viewport. |

## Browser coverage

Phone checks covered Home, commercial employee reports, the employee directory, payroll, sales, purchases, manufacturing, production-order planning, distribution, cashier, accounting, customers, expenses, financial reports, administration, the business cockpit, inventory, outlet reports and profile settings. Customer detail/edit/delete confirmation, item quick edit, sales line entry and the product picker were opened without saving business records.

The checked pages had no uncontained horizontal page overflow. Comparative tables may scroll within their own container.

| Viewport | Checks |
| --- | --- |
| 320 px phone | Main workspaces, customer edit/removal dialog, inventory quick edit, sales line entry and product picker |
| 390 px phone | Home, manufacturing, new production order and sales |
| 390 × 360 px short viewport | Search list and close control remain within the dialog; list scrolling remains usable |
| 640 px boundary | Customer page and shared navigation/header |
| 768 px tablet | Inventory and customers |
| 820 px tablet | Outlet reports |

The inventory check confirmed that all rendered product pictures loaded; catalogue pictures use the existing optimized WebP files.

## Verification

- ESLint: passed.
- Production webpack build: passed, including the customer lifecycle route.
- Final isolated suite: **1,068 passed, 0 failed**, across 158 test files.
- The subsequent preview-canvas adjustment passed its 3 focused render/route checks, lint and the production build. Its fitted 390 × 844 frame was also verified entirely inside the desktop viewport.
- The separate browser-launching test was excluded; interactive checks used the existing in-app browser instead.
- Role/access, accounting, stock, attribution and retry tests remain part of the isolated suite.

## Limits and next review

Browser checks used responsive Chromium viewports and the current General Manager session. Other roles and write paths were verified through isolated permission/domain/component tests. Real stock, money, payroll and customer mutations were not submitted. Physical iOS/Android keyboards, cameras and touch gestures still merit device testing during the next review.

Cold routes in the local development server compiled on their first visit; those delays are distinct from production performance. The optimized production build passed, but no production mobile network benchmark or Core Web Vitals measurement is claimed.

Review locally at **http://localhost:5175/dev-preview?mode=mobile**. Source changes appear in that development preview.
