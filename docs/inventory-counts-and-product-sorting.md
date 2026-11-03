# Stock counts and product browsing

Stock adjustment lists show one total per product in the selected warehouse.
Products held in several stock records expand to show their batch-specific
counts. Search by batch keeps the product's complete on-hand total visible.
Blank counts remain unchanged; only explicitly changed records reach posting.
Quality holds, expiry, carrying costs, signed references and audit evidence
remain attached to each original stock record.

Choosing **Count item** opens existing stock. **Add counted lot** is a separate,
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
No live records, database migrations or external publications are performed.
