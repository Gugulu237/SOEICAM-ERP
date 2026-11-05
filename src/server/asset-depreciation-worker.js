import 'server-only';
import { transaction } from './db.js';
import { serviceEntities } from './entities.js';
import { automaticDepreciationStatus, syncAutomaticDepreciation } from './domain/automatic-depreciation.js';

export async function synchronizeAssetDepreciation() {
  if (process.env.SOEICAM_BACKGROUND_JOBS==='disabled') return {...await automaticDepreciationStatus(serviceEntities),posted:0,total:0,disabled:true};
  return syncAutomaticDepreciation(serviceEntities,transaction);
}
export function startAssetDepreciationWorker() {
  if(globalThis.__soeicamAssetDepreciationWorker || !process.env.DATABASE_URL || process.env.SOEICAM_BACKGROUND_JOBS==='disabled' || process.env.NEXT_PHASE==='phase-production-build')return;
  let busy=false;
  const tick=async()=>{
    if(busy)return;busy=true;
    try {await synchronizeAssetDepreciation();}
    catch(error){console.error('Monthly asset depreciation check failed:',error.code||'database unavailable');}
    finally{busy=false;}
  };
  const timer=setInterval(tick,300000);timer.unref?.();
  globalThis.__soeicamAssetDepreciationWorker=timer;
  void tick();
}
