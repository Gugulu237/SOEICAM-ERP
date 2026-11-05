export async function register() {
  if(process.env.NEXT_RUNTIME==='nodejs') {
    const {startFermentationWorker}=await import('./server/fermentation-worker.js');
    startFermentationWorker();
    const {startDevicePushWorker}=await import('./server/device-push.js');
    startDevicePushWorker();
    const {startAssetDepreciationWorker}=await import('./server/asset-depreciation-worker.js');
    startAssetDepreciationWorker();
  }
}
