import 'server-only';
import { transaction } from './db.js';
import { serviceEntities } from './entities.js';
import { dispatchFermentationNotifications } from './domain/fermentation-notifications.js';

// Persistent dates live in the database. Restarts catch up overdue batches;
// deterministic event IDs and serializable transactions prevent duplicate alerts.
export function startFermentationWorker() {
  if(globalThis.__soeicamFermentationWorker || !process.env.DATABASE_URL || process.env.SOEICAM_BACKGROUND_JOBS==='disabled' || process.env.NEXT_PHASE==='phase-production-build')return;
  let busy=false,lastError=0;
  const tick=async()=>{
    if(busy)return;
    busy=true;
    try{await transaction(()=>dispatchFermentationNotifications(serviceEntities));}
    catch(error){if(Date.now()-lastError>300000){lastError=Date.now();console.error('Fermentation reminder worker could not check due batches:',error.code || 'database unavailable');}}
    finally{busy=false;}
  };
  const timer=setInterval(tick,30000);timer.unref?.();
  globalThis.__soeicamFermentationWorker=timer;
  void tick();
}
