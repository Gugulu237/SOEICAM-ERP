# Reserved Degustation and employee custody

The General Manager can expense legacy reserved promotional goods under **Distribution > Field stock > Stock balances > Expense reserved Degustation**. This applies only when the open run has no stock variance and every remaining physical unit is already reserved for Degustation. It does not amend sales, receivables or COGS.

Choose an active debit-normal XAF expense sub-account under Marketing, enter a review reference, and preview the lots, original costs and proposed journal. The operation verifies the paired original load, manifest values, approved stock issues, linked cost journals, remaining quantities and carrying values. Invalid, expired, already appropriated or unreconciled stock blocks posting.

Confirmation posts debit Degustation expense and credit finished-goods inventory at the verified remaining carrying value. Physical quantities remain with the employee and stay unavailable for sale. The operation records a value-only stock movement and immutable before/after audit evidence. No customer delivery is created.

Appropriated stock carries zero inventory asset value and separately protected remaining original cost basis. Actual customer giveaways reduce physical custody without another expense. A checked warehouse return restores only the unused original cost to inventory and credits the original expense account. Original accounts must remain suitable and the return period must be open. Cent residuals follow the final unit.

Preview tokens bind the reviewed records. A deterministic run identity and retained retry key prevent duplicate appropriation after a lost response. The API transaction commits the journal, stock valuation, custody markers, dispatch summary and audit evidence together; a failure rolls them back together. Generic entity writes cannot forge or erase these records.

This is a checked correction for legacy reserved allocations. It must not be replaced with a fictional customer giveaway, impersonation, an unsupported custody count adjustment, or a standalone journal that leaves stock carrying values inconsistent.

## Legacy unit-cost rounding

Some old stock issues multiplied quantities by a rounded unit cost instead of releasing the original lot value. A checked preview can reconcile that specific arithmetic only when the paired load, lot identities, quantities, every issue value, remaining cached value and posted source journals prove the original calculation exactly. A general tolerance does not authorize a correction. Other differences remain blocked and show the scoped lot evidence for review.

The preview separates the remaining promotional cost from rounding residues on fully sold lots. Residues on fully sold lots settle to the configured COGS account in a separate journal, with signed evidence for each lot. Remaining lot caches reconcile to their original loaded value less the already posted issues; this cache repair does not create an additional financial expense or stock issue. The subsequent Degustation appropriation expenses only that reconciled remaining basis.

All proposed journals and cache differences require review before confirmation. A rounding preview also requires the current interface to acknowledge its reviewed policy; an older open form cannot post an undisplayed correction. The rounding journal, protected value-only evidence, custody appropriation and before/after audit records commit together. Sales and original stock issues remain unchanged. Later giveaways and returns use only the reconciled promotional basis, without passing sold-stock rounding residues into Marketing.
