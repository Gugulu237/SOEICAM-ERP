const queryParams=value=>value instanceof URLSearchParams?new URLSearchParams(value):new URLSearchParams(Object.entries(value||{}).flatMap(([key,value])=>(Array.isArray(value)?value:[value]).filter(value=>value!=null).map(value=>[key,String(value)])));

export function manufacturingSection(requested){
  const aliases={recipes:'assemblies',orders:'history',quality:'batches'};
  return Object.hasOwn(aliases,requested)?aliases[requested]:requested;
}

// Retired recipe pages never load or mutate a recipe. A selected product still
// opens its saved assembly definition; a recipe ID is never treated as a product.
export function assemblyCataloguePath(search){
  const previous=queryParams(search),next=new URLSearchParams({section:'assemblies'}),assembly=previous.get('assembly')||previous.get('product');
  if(assembly)next.set('assembly',assembly);
  return '/manufacturing?'+next;
}

export function assemblyBuildPath(search){
  const previous=queryParams(search),next=new URLSearchParams({section:'build'}),product=previous.get('product')||previous.get('assembly');
  if(product)next.set('product',product);
  return '/manufacturing?'+next;
}
