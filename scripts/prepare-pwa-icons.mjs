// Reproducible installation sizes of the existing company logo; no new artwork.
import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),out=new URL('public/pwa/',root);
await mkdir(out,{recursive:true});
for(const [name,size,scale] of [['icon-192.png',192,.86],['icon-512.png',512,.86],['maskable-512.png',512,.68],['apple-touch-icon.png',180,.86]]){
  const logo=await sharp(fileURLToPath(new URL('public/brand/soeicam-logo.png',root))).resize({width:Math.round(size*scale),height:Math.round(size*scale),fit:'inside'}).png().toBuffer();
  await sharp({create:{width:size,height:size,channels:3,background:'#ffffff'}}).composite([{input:logo,gravity:'centre'}]).png().toFile(fileURLToPath(new URL(name,out)));
}
console.log('Prepared four SOEICAM installation icons.');
