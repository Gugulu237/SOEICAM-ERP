import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {productBackdropMask} from '../src/lib/product-photo-mask.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const widths=[96,256,512,960],output=path.join(root,'public/products/optimized');
await mkdir(output,{recursive:true});
const assets={};
for(const family of ['yola','soeicam']){
  const directory=path.join(root,'public/products',family);
  for(const name of (await readdir(directory)).sort()){
    if(!/^[a-z0-9.-]+\.(jpg|png)$/.test(name))continue;
    const original=await readFile(path.join(directory,name));
    // Hash the processing recipe too, so long-lived browser caches stay valid
    // when either the photo or its preparation changes.
    const hash=createHash('sha256').update(original).update('webp-76-square-v1'+productBackdropMask.toString()).digest('hex').slice(0,12);
    const prefix=`${family}-${name.replace(/\.(jpg|png)$/,'')}.${hash}`;
    const files=widths.map(width=>({width,name:`${prefix}.${width}.webp`}));
    const existing=await Promise.all(files.map(async file=>{try{return(await stat(path.join(output,file.name))).size>0;}catch{return false;}}));
    if(!existing.every(Boolean)){
      const decoded=await sharp(original).rotate().resize({width:960,height:960,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      const {width,height}=decoded.info;
      if(family==='yola'){
        const hidden=productBackdropMask({data:decoded.data,width,height});
        if(hidden)for(let pixel=0;pixel<hidden.length;pixel++)if(hidden[pixel])decoded.data[pixel*4+3]=0;
      }
      let prepared=sharp(decoded.data,{raw:{width,height,channels:4}});
      if(family==='yola')prepared=prepared.trim({threshold:8});
      const input=await prepared.png().toBuffer();
      for(const file of files)await sharp(input).resize({width:file.width,height:file.width,fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:76,alphaQuality:90,effort:5}).toFile(path.join(output,file.name));
    }
    assets[`/products/${family}/${name}`]={originalBytes:original.length,variants:await Promise.all(files.map(async file=>({width:file.width,src:`/products/optimized/${file.name}`,bytes:(await stat(path.join(output,file.name))).size})))};
  }
}
const generated=path.join(root,'src/lib/generated');await mkdir(generated,{recursive:true});
await writeFile(path.join(generated,'product-photo-assets.json'),JSON.stringify(assets,null,2)+'\n');
const originals=Object.values(assets).reduce((sum,asset)=>sum+asset.originalBytes,0);
const cards=Object.values(assets).reduce((sum,asset)=>sum+asset.variants.find(v=>v.width===512).bytes,0);
console.log(JSON.stringify({photos:Object.keys(assets).length,variants:Object.keys(assets).length*widths.length,originalBytes:originals,cardBytes:cards,reductionPercent:Math.round((1-cards/originals)*100)}));
