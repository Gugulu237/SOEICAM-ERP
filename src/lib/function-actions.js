// One classification for transaction boundaries and client invalidation. Unknown
// actions are treated as writes; session data is never cached here.
const fieldReads = new Set([
  'assemblyBuildWorkspace','previewAssemblyBuild',
  'customerAcquisitionOptions', 'warehouseAdjustmentWorkspace', 'existingStockWorkspace',
  'fieldStockInventory', 'driverReturnsWorkspace',
  'inventoryAuditWorkspace', 'inventoryAuditDetail', 'inventoryAuditMovements',
  'assetWorkspace', 'assetDepreciationPreview', 'commercialCashiers', 'cashierHandoverHistory', 'cashierWorkspace', 'purchasesWorkspace',
  'distributionControl', 'distributionIssueWorkspace', 'supplierWorkspace', 'employeeDashboard', 'dispatchActivity',
  'dispatchReconciliation', 'fieldCustomers', 'commercialPerformance', 'commercialDailySupplies',
  'expiredReturnReviewQueue', 'commercialReturns', 'outletReports', 'outletRoster', 'previewSale', 'proposedJournal',
  'yogurtWorkspace', 'checkProductionMaterials', 'productionPurchaseOptions', 'productionAuditRequests', 'batchCatalogue', 'batchTrace',
  'businessOverview', 'accountPosition', 'cashFlowReport', 'outletShelfOverview', 'companySales', 'invoiceWorkspace', 'invoiceDetail',
  'salesOrderWorkspace','salesOrderDeliveryPoints','salesOrderStock','invoiceSource', 'customerDeliveryWorkspace', 'customerMapWorkspace', 'deliveryZoneOptions',
]);
export function isReadOnlyFunction(name, action) {
  return name === 'fieldOps' && fieldReads.has(action);
}

// Share only work that is currently in progress, never settled financial data.
export function createInFlightReads() {
  const pending = new Map();
  return {
    run(key, load) {
      if (pending.has(key)) return pending.get(key);
      const promise = Promise.resolve().then(load);
      pending.set(key, promise);
      const clear = () => { if (pending.get(key) === promise) pending.delete(key); };
      promise.then(clear, clear);
      return promise;
    },
    clear() { pending.clear(); },
  };
}
