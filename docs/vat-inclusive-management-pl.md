# VAT-inclusive management P&L

The income statement defaults to **Sales including VAT**. The report uses posted net revenue plus the actual sales-VAT legs from the selected dated journal snapshot. It adds that VAT component to displayed revenue, gross profit, operating profit and the final management result. The VAT amount is shown separately, and the heading and exported report identify this presentation as a VAT-inclusive management P&L.

Choose **Accounting revenue excluding VAT** for the normal posted-accounting result. The VAT-inclusive presentation also shows the accounting net result as a comparison. Book revenue account rows and their journal drilldowns continue to display their exact posted amounts; a separate VAT supplement reconciles them to the management sales total.

Printing/PDF and Excel capture the selected presentation and dates before refreshing their ledger snapshot, then recompute the supplement from that fresh evidence. Unavailable or unmapped VAT evidence produces unavailable management totals and disables that export, rather than guessing VAT or silently using stale figures. The accounting view remains available.

This is a report presentation. It does not rewrite sales, VAT liability, stock costs, journal entries, cash flow or balance-sheet retained earnings.
