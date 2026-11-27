# Production with actual material quantities

Open **Manufacturing → Build assemblies**. Production managers and administrators record a batch in three steps:

1. **Materials used:** add the milk, sugar, flavours, preservatives and other raw materials actually used. Enter measured quantities and compatible units. The selector includes only active raw materials and additives. Finished goods, subassemblies, packaging, cleaning supplies, spare parts and other inventory are excluded.
2. **Finished output:** select each finished product and enter the quantity actually produced. Saved assembly components determine the automatic packaging requirement. For example, an assembly with one cup and one sticker per product consumes 30 cups and 30 stickers for 30 finished units.
3. **Review and complete:** review actual ingredient deductions, automatic packaging, remaining quantities, output expiry and carrying costs. Confirm to deduct the inputs and packaging and receive the finished stock together.

The first two steps are a draft. They do not reserve or deduct inventory. A failed final confirmation leaves stock and accounting unchanged. A lost response can be retried with the same reference without consuming materials twice.

## Quantity and costing rules

Raw ingredient quantities are never copied into deductions from the blueprint. Only materials explicitly entered for this batch are consumed. Each entered material must be a component of at least one selected assembly; add it to the relevant assembly first if necessary. An ingredient omitted from actual usage is not consumed automatically.

Packaging classification follows registered inventory type, group, category and packaging attributes. Item names alone do not decide automatic deductions. Keep cups, bottles, lids and stickers correctly classified. Packaging quantities use the saved component ratios, including any ratios other than one each.

Compatible mass/volume units are converted to the material's stock unit. Stock quantities retain three decimal places, and each-count units must be whole numbers. Invalid, duplicated, inactive, incompatible-unit or insufficient inputs block confirmation.

Mixed outputs share each actual ingredient according to their saved requirement proportions for that ingredient. A flavour used only by one selected output is allocated only to that output. Quantities and carrying costs reconcile to the batch totals. Costs come from the actual eligible stock lots consumed, not a manually entered price. Existing labour and overhead allocations remain unchanged.

The existing checked transaction retains stock eligibility, lot selection, accounting-period checks, staff attribution, audit history and retry protection. A changed input or inventory snapshot requires a refreshed review. Actual consumption, original blueprint quantities, per-output costs and source lots remain available in production records and batch traceability. Existing historical builds are not recalculated.

No schema migration or live inventory reset is required. Source installation and builds do not modify company records.
