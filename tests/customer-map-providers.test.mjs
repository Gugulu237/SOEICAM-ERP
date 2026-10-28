import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function adapters(){const result=await build({entryPoints:['src/components/customers/CustomerGeoMap.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['leaflet'],plugins:[{name:'map-platform',setup(b){b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'mocks'}));b.onResolve({filter:/google-maps$/},()=>({path:'google',namespace:'mocks'}));b.onLoad({filter:/.*/,namespace:'mocks'},({path})=>({resolveDir:process.cwd(),contents:path==='google'?'export const loadGoogleMaps=async()=>globalThis.__maps; export {googleMapsLibrary,googleMapsFailureMessage,safeGoogleMapsDiagnostic} from '+JSON.stringify(require.resolve('../src/lib/google-maps.js').replaceAll('\\','/'))+';':''}));}}]});const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);return module.exports;}
const fakeDocument={createElement:()=>({style:{},children:[],append(...nodes){this.children.push(...nodes);}})};
const points=Array.from({length:260},(_,i)=>({id:String(i),business_name:'<b>Customer '+i+'</b>',gps_lat:3.8+i/10000,gps_lng:11.5,gps_status:'ready'}));
const zone={id:'area',colour:'green',boundary:[{lat:3.8,lng:11.4},{lat:3.9,lng:11.4},{lat:3.9,lng:11.6}]};
test('Google map uses the maps namespace, plots all pins safely and removes overlays/listeners when refreshed or closed',async()=>{
 const {googleAdapter}=await adapters(),oldDocument=globalThis.document,layers=[],listeners=[],maps=[];
 class Layer{constructor(props){Object.assign(this,props);layers.push(this);}addListener(name,fn){const l={name,fn,removed:false,remove(){this.removed=true;}};listeners.push(l);return l;}setMap(map){this.map=map;}setOptions(props){Object.assign(this,props);}}
 class MapView extends Layer{constructor(element,props){super(props);this.element=element;maps.push(this);}setCenter(c){this.center=c;}setZoom(z){this.zoom=z;}getZoom(){return this.zoom;}fitBounds(b){this.bounds=b;}}
 class Bounds{constructor(){this.points=[];}extend(p){this.points.push(p);}isEmpty(){return !this.points.length;}}
 globalThis.document=fakeDocument;globalThis.__maps={importLibrary:async name=>name==='maps'?{Map:MapView,Polygon:Layer,Polyline:Layer,Circle:Layer}:{AdvancedMarkerElement:Layer},LatLngBounds:Bounds,event:{clearInstanceListeners:()=>{},trigger:()=>{},addListenerOnce:(_map,_event,fn)=>{fn();return {remove(){}};}}};
 const selected=[],vertices=[];let destroyed=0;
 try{const adapter=await googleAdapter({replaceChildren(){destroyed++;}},'test-key',p=>selected.push(p),()=>{},p=>vertices.push(p));adapter.render(points,[zone],'0',[],false);
   const pins=layers.filter(l=>l.content);assert.equal(pins.length,260);assert.equal(pins[0].title,'<b>Customer 0</b>');assert.equal(pins[0].content.innerHTML,undefined);assert.match(pins[0].content.children[1].children[0].src,/^\/_next\/image\?/);assert.equal(pins[0].content.children[1].children[0].alt,'YOLA');assert.equal(pins[0].content.children[2].textContent,'<b>Customer 0</b>');assert.equal(pins[0].content.children[2].innerHTML,undefined);assert.match(pins[0].content.children[2].style.cssText,/bottom:calc\(100%/);assert.equal(pins[0].anchorLeft,'-50%');assert.equal(pins[0].anchorTop,'-100%');assert.equal(maps[0].zoom,12);
   listeners.find(l=>l.name==='click'&&l!==listeners[0]).fn(); // zone click, safe independent callback
   listeners[0].fn({latLng:{lat:()=>3.85,lng:()=>11.5}});assert.deepEqual(vertices,[{lat:3.85,lng:11.5}]);
   adapter.frame('cameroon',points);assert.equal(maps[0].bounds.points.length,2);adapter.frame('points',points);assert.equal(maps[0].bounds.points.length,260);
   assert.equal(maps[0].clickableIcons,false);adapter.setExpanded(true);assert.equal(maps[0].gestureHandling,'greedy');adapter.setExpanded(false);assert.equal(maps[0].gestureHandling,'cooperative');
   const origin={lat:3.81,lng:11.49,accuracy:10},line=new Layer({path:[]}),route={path:[origin,{lat:3.85,lng:11.51}],createPolylines:()=>[line]};
   adapter.showRoute(route,origin,[points[0]]);assert.ok(layers.filter(l=>l.center).every(l=>Object.keys(l.center).every(k=>['lat','lng'].includes(k))));assert.equal(line.map,maps[0]);assert.equal(line.strokeColor,'#059669');assert.ok(maps[0].bounds.points.some(p=>p===origin));adapter.render(points,[zone],'1',[],false);assert.equal(line.map,maps[0]);adapter.clearRoute();assert.equal(line.map,null);
   adapter.render([],[],null,[],false);assert.ok(pins.every(p=>p.map===null));adapter.destroy();assert.ok(listeners.every(l=>l.removed));assert.equal(destroyed,1);
 }finally{globalThis.document=oldDocument;delete globalThis.__maps;}
});
test('OpenStreetMap keeps attribution, renders all pins and uses noninteractive overlays while drawing',async()=>{
 const {leafletAdapter}=await adapters(),oldDocument=globalThis.document,layers=[],handlers={},frames=[];globalThis.document=fakeDocument;let cleared=0,removed=0;
 const layer=(kind,args)=>{const row={kind,args,on(name,fn){this[name]=fn;return this;},off(){return this;},addTo(){layers.push(this);return this;}};return row;};
 const map={setView(...args){frames.push(args);return this;},on:(name,fn)=>{handlers[name]=fn;},fitBounds:(...args)=>frames.push(args),invalidateSize(){},remove(){removed++;}};
 const L={map:()=>map,tileLayer:(...args)=>layer('tiles',args),layerGroup:()=>({...layer('group'),clearLayers(){cleared++;}}),polygon:(...args)=>layer('polygon',args),divIcon:options=>options,marker:(...args)=>layer('pin',args),circleMarker:(...args)=>layer('vertex',args),polyline:(...args)=>layer('line',args),latLngBounds:p=>p};
 const vertices=[];const adapter=leafletAdapter(L,{},()=>{},()=>{},p=>vertices.push(p));
 adapter.render(points,[zone],'0',[],true);assert.equal(layers.filter(l=>l.kind==='pin').length,260);assert.equal(layers.find(l=>l.kind==='pin').args[1].interactive,false);assert.deepEqual(layers.find(l=>l.kind==='pin').args[1].icon.iconAnchor,[28,70]);assert.equal(layers.find(l=>l.kind==='pin').args[1].icon.html.children[1].children[0].alt,'YOLA');assert.match(layers.find(l=>l.kind==='tiles').args[1].attribution,/openstreetmap.org\/copyright/);
 handlers.click({latlng:{lat:3.85,lng:11.5}});assert.equal(vertices.length,1);adapter.frame('cameroon',points);adapter.frame('points',points);assert.equal(frames.at(-1)[0].length,260);adapter.destroy();assert.equal(cleared,1);assert.equal(removed,1);globalThis.document=oldDocument;
});

test('YOLA markers share one cached logo URL, retain safe customer labels and fall back without moving the GPS tip',async()=>{
 const {customerPinElement,customerPinSize,YOLA_LOGO_SRC,YOLA_LOGO_ORIGINAL}=await import('../src/lib/customer-map-pin.js'),old=globalThis.document;globalThis.document=fakeDocument;
 try{
  const pin=customerPinElement({title:'<img src=x onerror=alert(1)>',selected:true,colour:'#2563eb'}),face=pin.children[1],image=face.children[0],text=face.children[1];
  assert.equal(pin.title,'<img src=x onerror=alert(1)>');assert.equal(pin.innerHTML,undefined);assert.equal(pin.children[2].textContent,'<img src=x onerror=alert(1)>');assert.equal(pin.children[2].innerHTML,undefined);assert.match(pin.children[2].style.cssText,/text-overflow:ellipsis/);assert.match(pin.children[2].style.cssText,/pointer-events:none/);assert.equal(image.src,YOLA_LOGO_SRC);assert.equal(image.referrerPolicy,'no-referrer');assert.match(face.style.cssText,/#2563eb/);assert.match(face.style.cssText,/outline:3px/);
  const url=new URL(YOLA_LOGO_SRC,'http://localhost');assert.equal(url.searchParams.get('url'),YOLA_LOGO_ORIGINAL);assert.equal(url.searchParams.get('w'),'128');assert.equal(url.searchParams.get('q'),'75');
  image.onerror();assert.equal(image.src,YOLA_LOGO_ORIGINAL);image.onerror();assert.equal(image.hidden,true);assert.equal(text.hidden,false);assert.equal(text.textContent,'YOLA');assert.deepEqual(customerPinSize(true),{width:56,height:70});assert.deepEqual(customerPinSize(false),{width:48,height:62});
 }finally{globalThis.document=old;}
});
