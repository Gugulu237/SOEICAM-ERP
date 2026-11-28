# Finished-goods gross margins

Inventory's finished-product cards and phone rows show the gross margin at the current catalogue selling price. Open an item's quick view for the selling price, production cost per unit, gross profit per unit, and margin percentage.

The server uses weighted recorded carrying value divided by quantity across company warehouses. Previously expensed promotional allocations and recovery stock are excluded from that cost basis. Where there is no company stock, the registered production unit cost is used and labelled. A missing, zero or invalid cost produces an unavailable margin rather than a 100% margin.

The calculation uses the selling price exactly as entered, without deductions or adjustments. Gross profit per unit equals selling price minus production unit cost. Gross margin is gross profit divided by the selling price, multiplied by 100. For example, a selling price of 1,000 and a production cost of 600 give a profit of 400 and a margin of 40%. Operating expenses, discounts and the actual lots sold can change realised profitability; this is a read-only catalogue estimate.

The inventory API computes this projection only for staff who already have management-cost visibility. Commercial and other restricted profiles do not receive the derived cost or margin. No product costs, stock values, prices or accounting records are changed by viewing a margin.
