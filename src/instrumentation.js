export async function register() {
  if(process.env.NEXT_RUNTIME==='nodejs') {
    const {startFermentationWorker}=await import('./server/fermentation-worker.js');
    startFermentationWorker();
  }
}
