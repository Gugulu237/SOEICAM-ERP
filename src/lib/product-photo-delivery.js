import assets from './generated/product-photo-assets.json' with {type:'json'};

// Only reviewed bundled assets use these URLs. Uploads and arbitrary remote
// sources retain their original path and never become an unrestricted proxy.
export function productPhotoDelivery(source){
  const asset=Object.hasOwn(assets,source||'')?assets[source]:null;
  if(!asset)return null;
  return {src:asset.variants.find(v=>v.width===512).src,srcSet:asset.variants.map(v=>`${v.src} ${v.width}w`).join(', '),width:512,height:512};
}
