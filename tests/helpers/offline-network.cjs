// Optional preload for fixture tests: deny all network traffic, including telemetry.
// Use NODE_OPTIONS=--require=<absolute path> so Node test workers inherit it.
const {syncBuiltinESMExports}=require('node:module');
const deny=()=>{throw new Error('Network access is disabled in fixture tests.');};
for(const name of ['http','https']){const module=require('node:'+name);module.request=deny;module.get=deny;}
const net=require('node:net');net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;
require('node:tls').connect=deny;
const dns=require('node:dns');for(const name of ['lookup','resolve','resolve4','resolve6'])dns[name]=deny;
for(const name of ['lookup','resolve','resolve4','resolve6'])dns.promises[name]=async()=>deny();
globalThis.fetch=async()=>deny();
process.env.NEXT_TELEMETRY_DISABLED='1';
process.env.CLERK_TELEMETRY_DISABLED='1';
syncBuiltinESMExports();
