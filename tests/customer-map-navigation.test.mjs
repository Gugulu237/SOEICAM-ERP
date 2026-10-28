import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const compiled=await build({entryPoints:['src/lib/customer-map-navigation.js'],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(require,module,module.exports);
const {currentDeliveryPosition,deliveryRouteRequest,computeDeliveryRoute,createDeliveryNavigator,deliveryRouteFailure,deliveryNavigationMessage}=module.exports;
const stops=[{id:'outlet-1',business_name:'First entrance',gps_lat:'3.854321',gps_lng:'11.512345'},{id:'outlet-2',gps_lat:3.86,gps_lng:11.52},{id:'outlet-3',gps_lat:3.87,gps_lng:11.53}];
const origin={lat:3.81,lng:11.49,accuracy:12};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function gps(){let success,error,options;const tasks=new Map();let id=0;return {get success(){return success;},get error(){return error;},get options(){return options;},tasks,timers:{setTimeout(fn){tasks.set(++id,fn);return id;},clearTimeout(key){tasks.delete(key);}},geolocation:{getCurrentPosition(a,b,c){success=a;error=b;options=c;}}};}

test('directions use exact GPS entrances and the current driver position, preserving ordered stops',()=>{
 const request=deliveryRouteRequest(origin,stops,'fr');
 assert.deepEqual(request.origin,{lat:3.81,lng:11.49});
 assert.deepEqual(request.destination,{lat:3.87,lng:11.53});
 assert.deepEqual(request.intermediates,[{location:{lat:3.854321,lng:11.512345}},{location:{lat:3.86,lng:11.52}}]);
 assert.equal(request.optimizeWaypointOrder,false);assert.equal(request.computeAlternativeRoutes,false);assert.equal(request.routingPreference,'TRAFFIC_UNAWARE');
 assert.equal(request.language,'fr');assert.deepEqual(request.fields,['path','distanceMeters','durationMillis','legs','warnings']);assert.ok(!request.fields.includes('*'));
 assert.equal(JSON.stringify(request).includes('First entrance'),false);
 assert.throws(()=>deliveryRouteRequest(origin,[...stops,stops[0]]),{code:'ROUTE_INVALID_PIN'});
 assert.throws(()=>deliveryRouteRequest(origin,[{gps_lat:null,gps_lng:11.5}]),{code:'ROUTE_INVALID_PIN'});
 assert.throws(()=>deliveryRouteRequest({...origin,lat:NaN},stops),{code:'GPS_UNAVAILABLE'});
});

test('GPS is fresh, explicit, one-shot and clears timers on success without changing customer pins',async()=>{
 const fixture=gps(),before=structuredClone(stops),position=currentDeliveryPosition({...fixture,secure:true});
 assert.deepEqual(fixture.options,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
 fixture.success({coords:{latitude:origin.lat,longitude:origin.lng,accuracy:12},timestamp:1234});
 assert.deepEqual(await position,{...origin,timestamp:1234});assert.equal(fixture.tasks.size,0);assert.deepEqual(stops,before);
});

test('GPS denial, insecure context, invalid/poor fixes, timeout and cancellation are actionable',async()=>{
 for(const [kind,code] of [['denied','GPS_DENIED'],['invalid','GPS_UNAVAILABLE'],['poor','GPS_INACCURATE'],['timeout','GPS_TIMEOUT'],['abort','CANCELLED']]){
  const fixture=gps(),controller=new AbortController(),result=currentDeliveryPosition({...fixture,secure:true,signal:controller.signal});
  if(kind==='denied')fixture.error({code:1});
  if(kind==='invalid')fixture.success({coords:{latitude:NaN,longitude:11.5,accuracy:5}});
  if(kind==='poor')fixture.success({coords:{latitude:3.8,longitude:11.5,accuracy:2000}});
  if(kind==='timeout')[...fixture.tasks.values()][0]();
  if(kind==='abort')controller.abort();
  await assert.rejects(result,{code});assert.equal(fixture.tasks.size,0);
  fixture.success({coords:{latitude:3.8,longitude:11.5,accuracy:5}}); // late callback is ignored
 }
 await assert.rejects(currentDeliveryPosition({secure:false}),{code:'GPS_INSECURE'});
 await assert.rejects(currentDeliveryPosition({secure:true,geolocation:null}),{code:'GPS_UNAVAILABLE'});
});

test('Routes library is loaded only on request, with no alternate routes or Places lookup',async()=>{
 let imports=0,captured;
 const route={path:[origin,{lat:3.87,lng:11.53}],distanceMeters:1500,durationMillis:240000};
 const maps={importLibrary:async name=>{assert.equal(name,'routes');imports++;return {Route:{computeRoutes:async request=>{captured=request;return {routes:[route]};}}};}};
 assert.equal(imports,0);assert.equal(await computeDeliveryRoute(maps,origin,stops,'en'),route);assert.equal(imports,1);
 assert.equal(captured.language,'en');assert.deepEqual(captured.destination,{lat:3.87,lng:11.53});
});

test('Routes failures do not expose raw credentials or invent straight-line directions',async()=>{
 for(const [error,code] of [[{code:'PERMISSION_DENIED',message:'AIza-secret key not authorized'},'ROUTE_CONFIGURATION'],[{code:'RESOURCE_EXHAUSTED'},'ROUTE_QUOTA'],[{code:'MAPS_TIMEOUT'},'ROUTE_TIMEOUT'],[{message:'connection lost'},'ROUTE_UNAVAILABLE']]){
  await assert.rejects(computeDeliveryRoute({importLibrary:async()=>{throw error;}},origin,stops),err=>err.code===code&&!err.message.includes('AIza'));
 }
 await assert.rejects(computeDeliveryRoute({importLibrary:async()=>({Route:{computeRoutes:async()=>({routes:[]})}})},origin,stops),{code:'ROUTE_NOT_FOUND'});
});

test('new requests, clearing and leaving discard stale GPS and route responses',async()=>{
 const fixes=[],requests=[],drawn=[],states=[];let cleared=0;
 const navigator=createDeliveryNavigator({locate:({signal})=>{const f=deferred();fixes.push({...f,signal});return f.promise;},compute:(...args)=>{const r=deferred();requests.push({...r,args});return r.promise;},draw:(...args)=>drawn.push(args),clear:()=>cleared++,onChange:s=>states.push(s)});
 const first=navigator.start([stops[0]],'fr'),second=navigator.start([stops[1]],'fr');
 assert.equal(fixes[0].signal.aborted,true);
 fixes[0].resolve(origin);await first;assert.equal(requests.length,0);
 fixes[1].resolve(origin);await new Promise(setImmediate);assert.equal(requests.length,1);
 navigator.clear();requests[0].resolve({path:[origin]});await second;assert.equal(drawn.length,0);assert.equal(states.at(-1).phase,'idle');
 const third=navigator.start([stops[2]],'fr');fixes[2].resolve(origin);await new Promise(setImmediate);requests[1].resolve({path:[origin]});await third;assert.equal(drawn.length,1);assert.equal(states.at(-1).phase,'ready');
 const last=navigator.start([stops[0]],'fr');navigator.destroy();fixes[3].resolve(origin);await last;assert.equal(drawn.length,1);assert.equal(fixes[3].signal.aborted,true);assert.ok(cleared>=5);
});

test('failed GPS never computes a route or silently uses the city centre as origin',async()=>{
 let computed=0,last;
 const navigator=createDeliveryNavigator({locate:async()=>{throw {code:'GPS_DENIED'};},compute:()=>computed++,draw:()=>assert.fail(),clear(){},onChange:s=>{last=s;}});
 await navigator.start([stops[0]]);assert.equal(computed,0);assert.equal(last.error,'GPS_DENIED');
 navigator.destroy();
});

// Google Maps JS UnitSystem is numeric. The REST string passed validation but
// failed SDK wire conversion with "Unknown UnitSystem: METRIC" in v3.65.14a.
test('routing passes the Google JavaScript METRIC enum including its zero value',async()=>{
 let captured;
 const route={path:[origin,stops[0]]};
 const maps={UnitSystem:{METRIC:0,IMPERIAL:1},importLibrary:async()=>({Route:{computeRoutes:async request=>{
  captured=request;
  if(request.units!==0&&request.units!==1)throw Error('Unknown UnitSystem: '+request.units);
  return {routes:[route]};
 }}})};
 assert.equal(await computeDeliveryRoute(maps,origin,[stops[0]],'fr'),route);
 assert.equal(captured.units,0);assert.notEqual(captured.units,'METRIC');
 assert.equal(Object.hasOwn(deliveryRouteRequest(origin,[stops[0]]),'units'),false);
 delete maps.UnitSystem;
 maps.importLibrary=async()=>({Route:{computeRoutes:async request=>{assert.equal(Object.hasOwn(request,'units'),false);return {routes:[route]};}}});
 assert.equal(await computeDeliveryRoute(maps,origin,[stops[0]],'fr'),route);
});

test('numeric and nested Google failures distinguish configuration, request, quota, network and timeout without leaking data',()=>{
 const cases=[
  [{code:7,message:'Permission denied'},'ROUTE_CONFIGURATION','PERMISSION_DENIED'],
  [{status:'403'},'ROUTE_CONFIGURATION','PERMISSION_DENIED'],
  [{cause:{code:16}},'ROUTE_CONFIGURATION','PERMISSION_DENIED'],
  [{error:{details:[{reason:'SERVICE_DISABLED'}]}},'ROUTE_CONFIGURATION','SERVICE_DISABLED'],
  [{response:{data:{error:{code:403,details:[{reason:'API_KEY_SERVICE_BLOCKED'}]}}}},'ROUTE_CONFIGURATION','PERMISSION_DENIED'],
  [{code:8},'ROUTE_QUOTA','RESOURCE_EXHAUSTED'],
  [{status:429},'ROUTE_QUOTA','RESOURCE_EXHAUSTED'],
  [{code:3},'ROUTE_INVALID_REQUEST','INVALID_ARGUMENT'],
  [Object.assign(Error('Unknown UnitSystem: METRIC'),{name:'InvalidValueError'}),'ROUTE_INVALID_REQUEST','INVALID_ARGUMENT'],
  [{status:400},'ROUTE_INVALID_REQUEST','INVALID_ARGUMENT'],
  [{code:5},'ROUTE_NOT_FOUND','NOT_FOUND'],
  [{code:4},'ROUTE_TIMEOUT','DEADLINE_EXCEEDED'],
  [TypeError('Failed to fetch'),'ROUTE_NETWORK','NETWORK_ERROR'],
  [{message:'Unexpected provider error'},'ROUTE_UNAVAILABLE','UNKNOWN']
 ];
 for(const [input,code,providerCode] of cases){input.private='https://example.test/?key=AIzaFixtureSecret&origin=3.854321,11.512345';const error=deliveryRouteFailure(input);assert.equal(error.code,code);assert.equal(error.providerCode,providerCode);assert.doesNotMatch(JSON.stringify(error),/AIza|3\.854321|example\.test/);}
 const cyclic={code:7};cyclic.cause=cyclic;assert.equal(deliveryRouteFailure(cyclic).code,'ROUTE_CONFIGURATION');
 assert.doesNotMatch(deliveryNavigationMessage('ROUTE_INVALID_REQUEST'),/connection/i);
 assert.doesNotMatch(deliveryNavigationMessage('ROUTE_UNAVAILABLE'),/connection/i);
});

test('a failed route request preserves successful GPS and a render failure clears partial overlays',async()=>{
 let state,cleared=0;
 const navigator=createDeliveryNavigator({locate:async()=>origin,compute:async()=>{throw Object.assign(Error('Access blocked'),{code:'ROUTE_CONFIGURATION',providerCode:'PERMISSION_DENIED'});},draw:()=>assert.fail(),clear:()=>cleared++,onChange:s=>{state=s;}});
 await navigator.start([stops[0]]);assert.equal(state.phase,'error');assert.equal(state.failureStage,'request');assert.equal(state.origin,origin);assert.equal(state.providerCode,'PERMISSION_DENIED');navigator.destroy();
 const rendering=createDeliveryNavigator({locate:async()=>origin,compute:async()=>({path:[origin]}),draw:()=>{throw Error('Synthetic overlay failure');},clear:()=>cleared++,onChange:s=>{state=s;}});
 const before=cleared;await rendering.start([stops[0]]);assert.equal(state.error,'ROUTE_DISPLAY');assert.equal(state.failureStage,'display');assert.equal(state.origin,origin);assert.equal(cleared,before+2);rendering.destroy();
});
