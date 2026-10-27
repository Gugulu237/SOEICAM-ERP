function mapsError(code,message) {return Object.assign(new Error(message),{code});}
export function googleMapsFailureMessage(error) {
  if(error?.code==='MAPS_AUTHORIZATION')return 'Google Maps access was refused. Check Maps JavaScript API, billing and the website restrictions for this address.';
  if(error?.code==='MAPS_REFRESH_REQUIRED')return 'The Google Maps settings changed. Reload this page to apply them.';
  if(error?.code==='MAPS_TIMEOUT')return 'Google Maps took too long to load. Check your connection and reload the page.';
  return 'Google Maps could not start. Check the connection and map configuration, then reload the page.';
}
export function safeGoogleMapsDiagnostic(error) {
  let message=String(error?.message||'Map initialization failed.');
  for(const value of [process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID])if(value)message=message.replaceAll(value,'[hidden]');
  return message.replace(/AIza[\w-]{25,}/g,'[hidden]').replace(/([?&]key=)[^&\s"']+/gi,'$1[hidden]').slice(0,400);
}
export async function googleMapsLibrary(promise,timeoutMs=30000) {
  let timer;
  try {return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(mapsError('MAPS_TIMEOUT','Google Maps libraries timed out.')),timeoutMs);})]);}
  finally {clearTimeout(timer);}
}
export function loadGoogleMaps(apiKey) {
  if(!apiKey)return Promise.reject(mapsError('MAPS_MISSING_KEY','The Google customer map is not configured yet. Customer GPS capture remains available.'));
  if(window.__soeicamMapsApiKey&&window.__soeicamMapsApiKey!==apiKey)return Promise.reject(mapsError('MAPS_REFRESH_REQUIRED','Reload this page to use the updated Google Maps configuration.'));
  if(window.__soeicamMapsAuthFailed)return Promise.reject(mapsError('MAPS_AUTHORIZATION','Google Maps authorization failed. Check the enabled API, billing and allowed website.'));
  if(window.google?.maps?.importLibrary)return Promise.resolve(window.google.maps);
  if(window.__soeicamMapsPromise)return window.__soeicamMapsPromise;
  window.__soeicamMapsApiKey=apiKey;
  window.__soeicamMapsPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');let done=false;
    const fail=error=>{
      if(done)return;done=true;clearTimeout(timeout);script.remove();delete window.__soeicamMapsReady;window.__soeicamMapsPromise=null;
      reject(error||mapsError('MAPS_NETWORK','Google Maps could not load. Check the map key, enabled Maps JavaScript API, billing and website restrictions. GPS capture still works.'));
    };
    const timeout=setTimeout(()=>fail(mapsError('MAPS_TIMEOUT','Google Maps script timed out.')),20000);
    window.gm_authFailure=()=>{
      window.__soeicamMapsAuthFailed=true;
      window.dispatchEvent(new Event('soeicam:maps-auth-error'));
      fail(mapsError('MAPS_AUTHORIZATION','Google Maps authorization failed. Check the enabled API, billing and allowed website.'));
    };
    window.__soeicamMapsReady=()=>{if(done)return;done=true;clearTimeout(timeout);delete window.__soeicamMapsReady;resolve(window.google.maps);};
    const query=new URLSearchParams({key:apiKey,loading:'async',callback:'__soeicamMapsReady',v:'quarterly',region:'CM'});
    script.src='https://maps.googleapis.com/maps/api/js?'+query;script.async=true;script.onerror=()=>fail();
    document.head.append(script);
  });
  return window.__soeicamMapsPromise;
}
