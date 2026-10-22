// These PostgreSQL errors guarantee that the transaction was aborted.
// Connection loss, uniqueness errors and business validation are not safe
// automatic retries and retain their existing caller behavior.
export const isTransactionConflict = error => ['40001', '40P01'].includes(error?.code);
