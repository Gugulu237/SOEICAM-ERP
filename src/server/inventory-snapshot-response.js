import {createHash} from 'node:crypto';

// The caller authenticates and freshly reads scoped records before reaching
// this function. The tag avoids retransmitting an unchanged body, not a DB read.
export function inventorySnapshotResponse(data,ifNoneMatch){
  const body=JSON.stringify(data),etag='"'+createHash('sha256').update(body).digest('base64url')+'"';
  const headers={'Cache-Control':'private, no-store','ETag':etag,'Vary':'Cookie, Authorization'};
  if(ifNoneMatch===etag)return new Response(null,{status:304,headers});
  return new Response(body,{headers:{...headers,'Content-Type':'application/json'}});
}

