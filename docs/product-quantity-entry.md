# Product quantity entry

Sales, goods issuance and expired-stock reporting use a quantity bar anchored to the selected product. The same flow works on phone, tablet and desktop:

1. Tap a product image or title. A new product starts with an empty quantity field.
2. Type the full quantity, then choose **Add product** or press Enter in the field.
3. Tap a selected product to edit its current quantity. **Update quantity** replaces the amount. **Remove product** removes the selection explicitly.

Typing, cancellation and dismissing the bar do not change saved selection lines. The numeric field selects the existing value on focus. Its Enter handler prevents submission of an enclosing sale or collection form. The existing compact picker layer supplies anchoring, viewport collision handling, input focus and Escape dismissal. The quantity bar scrolls if vertical space is limited.

The quantity field and confirmation button each occupy a full row, so longer French labels cannot squeeze the number field. The field uses 16px text and a 48px minimum control height, with a numeric keyboard and Done action. Cancel and Remove share a separate row. Product titles wrap to two lines, and popup width is bounded by both the viewport and the available collision area.

`ProductQuantityBar` provides the common draft UI and positive, finite, three-decimal quantity validation. `SaleProductPicker` uses it for regular sales, free replacements and customer spoilage reports. `ProductCatalog` opts into it through `onQuantityChange` for warehouse loads, commercial dashboard sale entry and expired collections. Legacy catalogue open/select actions remain supported.

## Operational rules

- Sales and fresh replacements use current usable stock as their maximum. A selected product can still be reopened at its full stock quantity for editing or removal. The sale form continues to check combined paid and replacement quantities.
- Warehouse issuance uses approved, unexpired stock from the chosen source. The load list stores the exact confirmed quantity, permits corrections, and blocks confirmation for invalid quantities. Changing warehouses clears the load list and closes the quantity bar.
- Expired collection and customer spoilage quantities describe affected goods; fresh stock does not cap those reports. Their existing one-million-unit report limit still applies. A fresh exchange remains subject to availability and verification.
- Changing the collected product clears its expiry date and lot number so another product cannot inherit that batch evidence.
- The commercial dashboard passes the confirmed quantity into the sale once. It does not assume one unit or add the quantity again on refresh.
- Existing employee permissions, receipt requirements, transaction stock checks, approval rules and retry keys remain in their respective workflows. Choosing a quantity alone writes no inventory or accounting records.

## Verification

Fixture tests exercise large quantities, exact edits, cancellation, explicit removal, blank/zero/negative/excess precision/over-stock validation, changing availability, unavailable and unpriced products, busy states, catalogue filtering, sale handoff and totals, load retries, expired collection evidence, and independent role/stock/transaction checks. Live business records are not used for these tests. Local HTTP checks confirm the routes respond; on-device keyboard and layout review is manual.
