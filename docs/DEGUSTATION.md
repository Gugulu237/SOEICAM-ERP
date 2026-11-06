# Dégustation: customer giveaways

Warehouse staff use **Inventory → Issue goods** and follow the normal employee, warehouse and sale-product selection. Selecting **Continue** asks **Are you also issuing Dégustation units?** Staff explicitly choose No to finish a normal issue, or Yes to select the additional giveaway products and quantities. The review shows sale, Dégustation and total quantities before one **Confirm & issue goods** action. Combined quantities are checked against available stock; returning to edit sale quantities rechecks the giveaway allowance. Changing the source warehouse clears both selections.

The combined load is transferred into the employee's existing delivery custody, preserving batch, expiry and cost. Driver and vehicle remain optional. For a giveaway-only load, staff continue without sale products, choose Yes and add Dégustation units. Old loads with no Dégustation allocation remain fully available for sale.

The signed-in employee uses **My issued stock → Record Dégustation**, chooses a registered customer (including a customer branch), and enters the quantities actually handed out. The employee cannot use another employee's run or consume the sale allocation as a giveaway. Sales and replacement workflows cannot consume the reserved giveaway allocation. Expired and quarantined units remain unavailable for distribution.

Before the first giveaway, the General Manager maps **Marketing · Dégustation** in Accounting → Posting Rules to an active expense account. The rule key is marketing_degustation_expense. The setup screen shows this mapping even on existing installations where it has not yet been created. No account number is assumed and no live account is created by deployment.

Loading stock is an internal transfer and does not create an expense. On a recorded handout, one transaction:

- issues the actual lot quantities from employee/vehicle custody;
- debits the configured marketing expense and credits the product's inventory account, using carrying cost (or the finished-goods inventory posting rule where the product has no specific account);
- saves the customer, employee, timestamp, reference, batch movements and journal linkage;
- creates no sale, invoice, revenue, receivable, cash collection or cash-handover obligation.

The posted expense appears in profit and loss for the handout date. Zero-cost carrying stock is recorded with zero expense; no estimated selling price or cost is invented. Retry keys bind to the employee and exact request details. Stock, journal and evidence roll back together on a failure, including a closed accounting period.

Unused units remain inventory and return through the normal warehouse physical count. Returns separately retain the unused Dégustation quantity without posting another expense. Reconciliation shows allocated, handed-out, remaining and returned giveaways, alongside sales and replacements. Giveaway history includes the customer, products and quantities; management also sees cost and journal references. Drivers can see giveaway movements in their own load. Customer batch traceability includes the giveaway recipient.

Existing entity extension fields are used, so no database migration or data reset is required. Builds and tests never change live company records.
