# Stock counts and product browsing

The default stock count shows one row per item in the selected warehouse:
item/code, system quantity, physical quantity and difference. Blank counts stay
unchanged, and zero means the item is physically empty. Search, sorting and
pagination retain entered counts.

Choose a warehouse and then **Packaging**, **Raw materials**, **Finished
products** or **All items**. The default follows the selected warehouse's type;
an explicit group can also be counted in a mixed storage location. Classification
matches Inventory, including legacy packaging recorded through material groups,
categories or packaging attributes. Each group shows only its own items and the
physical quantities in that warehouse. Empty items in the group remain available
for a first count. Counts include held and expired stock physically present.

The warehouse and group stay locked once quantities are entered, until the sheet
is cleared or posted. The review, server validation and saved receipt retain the
selected group. No other group or warehouse is included in that posting.

Review shows the differences and balanced accounting entry before posting.
Shortages debit the selected stock-loss expense account and credit the item's
inventory asset account; surpluses debit inventory and credit a dedicated
other-income account. Amounts use recorded carrying values. Stock, movements,
journal and the immutable item/batch receipt save in one transaction.

A shortage can proceed from the physical item total without entering every batch
again. Existing stock layers are reduced in the same earliest-expiry-first order
used for stock issues; undated layers come last, and stock-record IDs break ties.
Each layer retains its own carrying cost. The review identifies this as an
allocation, rather than an independently observed count of each batch. The server
recomputes marked allocations and saves the method in the immutable receipt.

**Review batch quantities** allows an explicit correction when counted lots differ
from the proposed allocation. Editing starts from the displayed quantities; they
must still add up to the physical item total. Ambiguous surpluses require explicit
batch quantities. A zero total empties all batches. New stock needs its lot details
and stays on quality hold; packaging does not require a supplier lot or expiry.
Existing expiry, quality holds and stock history remain attached to each record.
Shortages create an expense and reduce inventory; they do not create supplier
payables or another liability. The existing loss-account selection remains required.

Every stock record and the item's unit, cost and asset mapping are checked
again on the server, including unchanged lots and concurrent new receipts.
Changed source data blocks posting. The visible sheet checks fresh uncached stock
every 30 seconds, when the app regains focus, on catalogue changes, and through
**Refresh quantities**. With no counts, the latest figures replace the sheet.
Unchanged counted products retain their drafts while unrelated stock refreshes.
Changes to a counted product, any of its lots, its item configuration or the count
date require reload and recount; the system never silently rebases physical counts.
Failed refreshes preserve the draft and block posting until a check succeeds.

After a save has been attempted, its original snapshot and retry key remain
frozen until the response is resolved or the user explicitly reloads and clears
the sheet. Retrying the same successful request returns the saved receipt without
posting another adjustment. Stock and item snapshots are still rechecked inside
the posting transaction, so movements between a periodic check and Save are caught.

Lot and valuation tools retain the separate detailed correction workflow.

Opening-stock quantities and physical counts use the same three-decimal stock
precision. A legacy value such as `49.99999999999999` is recognized as `50` only
when the difference is within machine-level floating-point noise. This prevents
otherwise valid packaging and raw-material counts from being disabled. Genuine
extra precision, negative stock, residual values on empty lots and missing
valuations still require the existing accounting checks. Original stock records
remain part of the concurrency fingerprint, including unchanged batches; reading
a count sheet does not rewrite historical balances or their carrying values.

In detailed tools, **Count item** opens existing stock. **Add counted lot** is a separate,
explicit action for a newly found physical lot; only one unsaved new lot per
product is offered at a time. The server rejects existing lot and production
batch aliases, ignoring case and surrounding spaces.

The common **Sort by** control offers name, size ascending/descending and
flavour in inventory catalogues/counts, stock on hand, warehouse/vehicle lists,
sales/spoilage/replacement pickers, goods issue/returns, supply requests,
supplier catalogues/purchase orders, recipe/component selection and Hôtesse
product views. Sorting changes presentation only. Selected IDs, quantities,
prices and posted transaction order remain unchanged.

Sizes compare compatible units numerically (500 g precedes 1 kg; 330 ml
precedes 1 litre). Mass and volume remain separate, and missing sizes are last.
Flavour aliases use the same canonical labels; equal flavours sort by size.
Pagination applies after sorting. Batch expiry priority is unchanged.

Validation uses isolated stock/accounting fixtures and real component callbacks.
It does not change live records or run database migrations.
