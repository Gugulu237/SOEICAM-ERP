import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function adapters(){const result=await build({entryPoints:['src/components/customers/CustomerGeoMap.jsx'],bundle:true,platform:'node',format:'cjs',write:false,external:['leaflet'],plugins:[{name:'map-platform',setup(b){b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'mocks'}));b.onResolve({filter:/google-maps$/},()=>({path:'google',namespace:'mocks'}));b.onLoad({filter:/.*/,namespace:'mocks'},({path})=>({resolveDir:process.cwd(),contents:path==='google'?'export const loadGoogleMaps=async()=>globalThis.__maps; export {googleMapsLibrary,googleMapsFailureMessage,safeGoogleMapsDiagnostic} from '+JSON.stringify(require.resolve('../src/lib/google-maps.js').replaceAll('\\','/'))+';':''}));}}]});const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);return module.exports;}
const points=Array.from({length:260},(_,i)=>({id:String(i),business_name:'<b>Customer '+i+'</b>',gps_lat:3.8+i/10000,gps_lng:11.5,gps_status:'ready'}));
const zone={id:'area',colour:'green',boundary:[{lat:3.8,lng:11.4},{lat:3.9,lng:11.4},{lat:3.9,lng:11.6}]};
test('Google map uses the maps namespace, plots all pins safely and removes overlays/listeners when refreshed or closed',async()=>{
 const {googleAdapter}=await adapters(),oldDocument=globalThis.document,layers=[],listeners=[],maps=[];
 class Layer{constructor(props){Object.assign(this,props);layers.push(this);}addListener(name,fn){const l={name,fn,removed:false,remove(){this.removed=true;}};listeners.push(l);return l;}setMap(map){this.map=map;}}
 class MapView extends Layer{constructor(element,props){super(props);this.element=element;maps.push(this);}setCenter(c){this.center=c;}setZoom(z){this.zoom=z;}getZoom(){return this.zoom;}fitBounds(b){this.bounds=b;}}
 class Bounds{constructor(){this.points=[];}extend(p){this.points.push(p);}isEmpty(){return !this.points.length;}}
 globalThis.document={createElement:()=>({style:{}})};globalThis.__maps={importLibrary:async name=>name==='maps'?{Map:MapView,Polygon:Layer,Polyline:Layer,Circle:Layer}:{AdvancedMarkerElement:Layer},LatLngBounds:Bounds,event:{clearInstanceListeners:()=>{},trigger:()=>{},addListenerOnce:(_map,_event,fn)=>{fn();return {remove(){}};}}};
 const selected=[],vertices=[];let destroyed=0;
 try{const adapter=await googleAdapter({replaceChildren(){destroyed++;}},'test-key',p=>selected.push(p),()=>{},p=>vertices.push(p));adapter.render(points,[zone],'0',[],false);
   const pins=layers.filter(l=>l.content);assert.equal(pins.length,260);assert.equal(pins[0].title,'<b>Customer 0</b>');assert.equal(pins[0].content.innerHTML,undefined);assert.equal(maps[0].zoom,12);
   listeners.find(l=>l.name==='click'&&l!==listeners[0]).fn(); // zone click, safe independent callback
   listeners[0].fn({latLng:{lat:()=>3.85,lng:()=>11.5}});assert.deepEqual(vertices,[{lat:3.85,lng:11.5}]);
   adapter.frame('cameroon',points);assert.equal(maps[0].bounds.points.length,2);adapter.frame('points',points);assert.equal(maps[0].bounds.points.length,260);
   adapter.render([],[],null,[],false);assert.ok(pins.every(p=>p.map===null));adapter.destroy();assert.ok(listeners.every(l=>l.removed));assert.equal(destroyed,1);
 }finally{globalThis.document=oldDocument;delete globalThis.__maps;}
});
test('OpenStreetMap keeps attribution, renders all pins and uses noninteractive overlays while drawing',async()=>{
 const {leafletAdapter}=await adapters(),layers=[],handlers={},frames=[];let cleared=0,removed=0;
 const layer=(kind,args)=>{const row={kind,args,on(name,fn){this[name]=fn;return this;},off(){return this;},addTo(){layers.push(this);return this;}};return row;};
 const map={setView(...args){frames.push(args);return this;},on:(name,fn)=>{handlers[name]=fn;},fitBounds:(...args)=>frames.push(args),invalidateSize(){},remove(){removed++;}};
 const L={map:()=>map,tileLayer:(...args)=>layer('tiles',args),layerGroup:()=>({...layer('group'),clearLayers(){cleared++;}}),polygon:(...args)=>layer('polygon',args),circleMarker:(...args)=>layer('pin',args),polyline:(...args)=>layer('line',args),latLngBounds:p=>p};
 const vertices=[];const adapter=leafletAdapter(L,{},()=>{},()=>{},p=>vertices.push(p));
 adapter.render(points,[zone],'0',[],true);assert.equal(layers.filter(l=>l.kind==='pin').length,260);assert.equal(layers.find(l=>l.kind==='pin').args[1].interactive,false);assert.match(layers.find(l=>l.kind==='tiles').args[1].attribution,/openstreetmap.org\/copyright/);
 handlers.click({latlng:{lat:3.85,lng:11.5}});assert.equal(vertices.length,1);adapter.frame('cameroon',points);adapter.frame('points',points);assert.equal(frames.at(-1)[0].length,260);adapter.destroy();assert.equal(cleared,1);assert.equal(removed,1);
});
