// Original YOLA brand asset from the SOEICAM website repository.
// The image optimizer caches one small rendition for every map pin.
export const YOLA_LOGO_ORIGINAL='https://raw.githubusercontent.com/Gugulu237/SOEICAM/33d6fb5964f26ed01764f35f538bb2a90cdeded5/public/brand/logos/yola.png';
export const YOLA_LOGO_SRC='/_next/image?url='+encodeURIComponent(YOLA_LOGO_ORIGINAL)+'&w=128&q=75';
export const customerPinSize=selected=>selected?{width:56,height:70}:{width:48,height:62};
export function customerPinElement({colour='#059669',selected=false,title='YOLA'}={}){
 const {width,height}=customerPinSize(selected),root=document.createElement('div'),tip=document.createElement('span'),face=document.createElement('span'),image=document.createElement('img'),fallback=document.createElement('span');
 root.className='yola-customer-pin';root.title=String(title||'YOLA');
 root.style.cssText='position:relative;box-sizing:border-box;width:'+width+'px;height:'+height+'px;filter:drop-shadow(0 2px 3px #0f172a55);cursor:pointer';
 tip.style.cssText='position:absolute;box-sizing:border-box;width:16px;height:16px;bottom:3px;left:calc(50% - 8px);transform:rotate(45deg);background:'+colour;
 face.style.cssText='position:absolute;box-sizing:border-box;inset:0 0 auto;height:'+width+'px;border:3px solid '+colour+';border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;'+(selected?'outline:3px solid #0f172a;outline-offset:2px;':'');
 image.src=YOLA_LOGO_SRC;image.alt='YOLA';image.width=width-10;image.height=width-10;image.decoding='async';image.referrerPolicy='no-referrer';image.draggable=false;
 image.style.cssText='display:block;width:calc(100% - 6px);height:calc(100% - 6px);object-fit:contain';
 fallback.textContent='YOLA';fallback.hidden=true;fallback.style.cssText='font:800 12px system-ui;color:#123c78';
 let direct=false;image.onerror=()=>{if(!direct){direct=true;image.src=YOLA_LOGO_ORIGINAL;}else{image.hidden=true;image.style.display='none';fallback.hidden=false;}};
 face.append(image,fallback);root.append(tip,face);return root;
}
