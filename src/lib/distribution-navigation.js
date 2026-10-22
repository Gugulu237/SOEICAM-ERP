export const DISTRIBUTION_PATH='/distribution';
export function distributionPath(tab='stock',search={}){
  const query=new URLSearchParams();for(const [key,value] of search instanceof URLSearchParams?search.entries():Object.entries(search))for(const item of Array.isArray(value)?value:[value])if(item!=null)query.append(key,String(item));query.set('tab',tab);return DISTRIBUTION_PATH+'?'+query.toString();
}
