# Counted ingredients and packaging

New quantity-adjustment lots for ingredients and packaging are approved immediately and can be consumed by assembly builds. Both the physical item-count preview and detailed count screen use this status. A separate Ready for production use checkbox is no longer needed.

Recounting an older adjustment lot also clears its accidental quarantine, including a status-only correction that does not change quantity or carrying value. The existing adjustment audit records retain the previous status and the resulting status. Status-only corrections do not post another journal.

Recorded expiry dates, rejected stock, manufacturing batches, recovered packaging, location restrictions, role checks, accounting postings and retry protection retain their existing rules. Counted finished goods continue to use their explicit sale-release workflow.

Validation: isolated JavaScript domain checks covered new ingredient/packaging counts, simple item counts, availability projections, legacy adjustment release, retry reuse and restricted lots. Regression tests were updated for the new defaults and checkbox removal. The local execution environment disconnected during the task, so the repository's Node test suite, lint and production build still need to run before merging.
