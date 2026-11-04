let appearancePromise;
const localePromises=new Map();

export function isClerkWidgetRoute(pathname){
  // Operational pages use the auth SDK but do not mount account widgets.
  return /^\/(?:login|register|profile)(?:\/|$)/.test(pathname || '');
}

function appearance(){
  if(!appearancePromise)appearancePromise=import('@clerk/ui/themes').then(({shadcn})=>({
    theme:shadcn,
    // Tailwind 3 stores HSL channels; Clerk expects complete CSS colors.
    variables:{
      colorBackground:'hsl(var(--card))',colorForeground:'hsl(var(--card-foreground))',
      colorInput:'hsl(var(--input))',colorInputForeground:'hsl(var(--card-foreground))',
      colorDanger:'hsl(var(--destructive))',colorMuted:'hsl(var(--muted))',
      colorMutedForeground:'hsl(var(--muted-foreground))',colorNeutral:'hsl(var(--foreground))',
      colorPrimary:'hsl(var(--primary))',colorPrimaryForeground:'hsl(var(--primary-foreground))',
      colorRing:'hsl(var(--ring))',colorModalBackdrop:'rgba(0,0,0,0.5)',
      fontWeight:{normal:400,medium:500,semibold:600,bold:700},
    },
  })).catch(error=>{appearancePromise=undefined;throw error;});
  return appearancePromise;
}

function localization(language){
  const locale=language==='fr'?'fr':'en';
  if(!localePromises.has(locale)){
    const request=locale==='fr'
      ?import('@clerk/localizations/fr-FR').then(module=>module.frFR)
      :import('@clerk/localizations/en-US').then(module=>module.enUS);
    localePromises.set(locale,request.catch(error=>{localePromises.delete(locale);throw error;}));
  }
  return localePromises.get(locale);
}

export async function loadClerkUiOptions(language){
  const [theme,locale]=await Promise.all([appearance(),localization(language)]);
  return {appearance:theme,localization:locale};
}
