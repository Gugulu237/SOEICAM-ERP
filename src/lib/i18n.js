import french from './locales/fr.json' with {type:'json'};
const listeners=new Set();
const foldedFrench=new Map(Object.entries(french).map(([en,fr])=>[en.toLowerCase(),fr]));
let language='en',identity=null,companyLanguage='fr';
export const supportedLanguages=['fr','en'];
export const localeFor=lang=>lang==='fr'?'fr-CM':'en-CM';
export const getLanguage=()=>language;
export const getLocale=()=>localeFor(language);
export const subscribeLanguage=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
export function setLanguage(value){if(!supportedLanguages.includes(value))return;if(language!==value){language=value;for(const listener of listeners)listener();}if(typeof document!=='undefined')document.documentElement.lang=value;}
const key=id=>'soeicam-language:'+(id||'guest');
export function readLocalLanguage(id){try{const value=localStorage.getItem(key(id));return supportedLanguages.includes(value)?value:null;}catch{return null;}}
export function setLocalLanguage(id,value){try{if(value)localStorage.setItem(key(id),value);else localStorage.removeItem(key(id));}catch{/* Browser storage is optional. */}}
export function configureLanguage({userId=null,preferredLanguage=null,defaultLanguage='fr'}={}){
  identity=userId;companyLanguage=supportedLanguages.includes(defaultLanguage)?defaultLanguage:'fr';
  const preferred=supportedLanguages.includes(preferredLanguage)?preferredLanguage:null;
  // The saved account preference is authoritative, including a saved default.
  // Clear this browser's old override when another device resets it to default.
  setLocalLanguage(userId,preferred);
  setLanguage(preferred||companyLanguage);
}
export const languageIdentity=()=>identity;
export const defaultLanguage=()=>companyLanguage;
export function updateCompanyLanguage(value){if(!supportedLanguages.includes(value))return;companyLanguage=value;if(!readLocalLanguage(identity))setLanguage(value);}
export function translate(source,lang=language,...values){
  if(typeof source!=='string')return source;
  const normalized=source.replace(/\s+/g,' ').trim();
  const translation=lang==='fr'?(french[source]??french[normalized]??foldedFrench.get(normalized.toLowerCase())):undefined;
  const text=translation===undefined?source:(source.match(/^\s*/)?.[0]||'')+translation.trim()+(source.match(/\s*$/)?.[0]||'');
  return text.replace(/\{(\d+)\}/g,(match,index)=>Number(index)<values.length?String(values[Number(index)]??''):match);
}
export const ui=(source,...values)=>translate(source,language,...values);
const messageSources=new Map();
export function sourceMessage(source,...values){const text=translate(source,'en',...values);if(messageSources.size>2000)messageSources.clear();messageSources.set(text,{source,values});return text;}
const reverseFrench=new Map(Object.entries(french).map(([en,fr])=>[fr,en]));
const escapePattern=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.keys(french).filter(s=>/\{\d+\}/.test(s)).map(source=>{
  const indices=[];let cursor=0,pattern='^';for(const match of source.matchAll(/\{(\d+)\}/g)){pattern+=escapePattern(source.slice(cursor,match.index))+'([\\s\\S]*?)';indices.push(Number(match[1]));cursor=match.index+match[0].length;}pattern+=escapePattern(source.slice(cursor))+'$';return {source,indices,pattern:new RegExp(pattern)};
});
// Only call on trusted interface labels/errors, never on business record values.
export function uiMessage(message){
  if(typeof message!=='string')return message;
  const saved=messageSources.get(message);if(saved)return translate(saved.source,language,...saved.values);
  if(language==='en')return reverseFrench.get(message)??message;
  if(french[message])return french[message];
  for(const {source,indices,pattern} of patterns){const match=pattern.exec(message);if(match){const values=[];indices.forEach((index,i)=>{values[index]=match[i+1];});return translate(source,language,...values);}}
  return message;
}
