# Product quantity entry

Sales and replacements use a full-screen catalogue with compact image/title tiles. Price, repeated size, unit and available-stock labels are hidden; family/size grouping and a selected-quantity badge remain. Tapping an item opens a small quantity dialog. Goods issuance and expired-stock collections retain their anchored quantity bar. The same confirmation flow works on phone, tablet and desktop:

1. Tap a product image or title. A new product starts with an empty quantity field.
2. Type the full quantity, then choose **Add product** or press Enter in the field.
3. Tap a selected product to edit its current quantity. **Update quantity** replaces the amount. **Remove product** removes the selection explicitly.

Typing, cancellation and dismissing the prompt do not change saved selection lines. The numeric field selects the existing value on focus. Its Enter handler prevents submission of an enclosing sale or collection form. The sales quantity dialog uses the app's nested focus trap, Escape and device Back handling. It restores focus to the selected tile and follows the visual viewport above the phone keyboard. The dialog is limited to 320px wide and scrolls if vertical space is limited. A per-opening token prevents repeated confirmations and callbacks from discarded prompts from adding duplicate or wrong-product quantities. Confirmation rechecks the latest stock and disabled state.

The quantity field and confirmation button each occupy a full row, so longer French labels cannot squeeze the number field. The field uses 16px text and a 48px control height, with a numeric keyboard and Done action. The sales prompt uses its close button to cancel and shows Remove next to Update for an existing selection. Warehouse bars retain Cancel and Remove on a separate row. Product titles wrap, and popup width is bounded by the viewport. The memoized sales image grid and grouped catalogue stay stable while a quantity is typed.

`ProductQuantityBar` provides the common draft UI and positive, finite, three-decimal quantity validation. `SaleProductPicker` uses it for regular sales, free replacements and customer spoilage reports. `ProductCatalog` opts into it through `onQuantityChange` for warehouse loads, commercial dashboard sale entry and expired collections. Legacy catalogue open/select actions remain supported.

## Operational rules

- Sales and fresh replacements use current usable stock as their maximum. The paid picker subtracts quantities already reserved for replacements; the replacement picker subtracts paid lines and other replacement rows. A selected product can still be reopened for editing or removal. Both sale forms and the server retain their combined paid-and-replacement stock checks.
- Warehouse issuance uses approved, unexpired stock from the chosen source. The load list stores the exact confirmed quantity, permits corrections, and blocks confirmation for invalid quantities. Changing warehouses clears the load list and closes the quantity bar.
- Expired collection and customer spoilage quantities describe affected goods; fresh stock does not cap those reports. Their existing one-million-unit report limit still applies. A fresh exchange remains subject to availability and verification.
- Changing the collected product clears its expiry date and lot number so another product cannot inherit that batch evidence.
- The commercial dashboard passes the confirmed quantity into the sale once. It does not assume one unit or add the quantity again on refresh.
- Existing employee permissions, receipt requirements, transaction stock checks, approval rules and retry keys remain in their respective workflows. Choosing a quantity alone writes no inventory or accounting records.

## Verification

Fixture tests exercise large quantities, exact edits, cancellation, explicit removal, blank/zero/negative/excess precision/over-stock validation, changing availability, unavailable and unpriced products, busy states, catalogue filtering, sale handoff and totals, load retries, expired collection evidence, and independent role/stock/transaction checks. Live business records are not used for these tests. Local HTTP checks confirm the routes respond; on-device keyboard and layout review is manual.
