# Recording a sale for a commercial

An administrator opens **Sales > Record sale** and selects **Person making the sale** in the first step. The list contains the signed-in administrator and active Commercial staff, including staff without login accounts and custom roles based on the Commercial template. Other users continue to record under their own identity.

Select the commercial who actually supplied the customer, then enter the original sale date and receipt reference. If that commercial has one compatible open issued load, it is selected automatically. Multiple loads require a choice. If no load matches, the administrator must explicitly choose company or warehouse stock. An issued load belonging to another commercial cannot be used for an assisted sale. Changing the salesperson refreshes the available quantities and retains entered quantities for review.

The order and invoice credit the selected commercial. The signed-in administrator remains the recording and audit actor. Recording a cash sale leaves the existing cashier confirmation process in place; entering the sale does not mean that the administrator received the money. Successful retries return the original result, and a used submission reference cannot be reassigned to another salesperson.

New verified supplied orders appear in the selected commercial's monthly sales, daily supplies, dashboard totals and performance reports. The saved role at the time of sale preserves Commercial attribution if that employee later changes role. Report projections are read-only and keep their SalesOrder identity; they do not create duplicate FieldSale records or extra cash handovers. Credited sales follow the existing dated reversal reporting. Legacy orders without the new verified attribution audit are not backfilled into these projections.

The commercial's personal POS and management dashboard previews retain their existing access rules. Completed orders keep the saved salesperson name even if the employee is later renamed or made inactive.
