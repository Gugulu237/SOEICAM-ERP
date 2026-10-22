import { WAREHOUSE_ARTWORK } from '@/lib/warehouse-presentation';

// The supplied transparent PNGs are preserved; CSS colours their alpha shapes.
// Locations without supplied artwork retain a single matching vector object.
const paper = '#f8fbf8';
const light = '#dceade';
const mid = '#a5c8ae';
const dark = '#397353';

function WarehouseObject({ type }) {
  switch (type) {
    case 'finished_goods':
      return <>
        <rect x="51" y="16" width="26" height="12" rx="3" fill={dark} />
        <path d="M53 28v11c0 10-13 14-13 26v31c0 7 6 12 12 12h24c6 0 12-5 12-12V65c0-12-13-16-13-26V28Z" fill={light} />
        <path d="M73 39c0 12 11 17 11 29v27c0 6-3 9-9 9h-7c6-4 8-9 8-17V66c0-10-7-16-7-27" fill={mid} stroke="none" />
        <path d="M40 67h48v24H40Z" fill={paper} />
        <path d="M55 76h18m-14 7h10" stroke={dark} strokeWidth="3" />
        <path d="M49 58c1-4 5-6 7-9" stroke={paper} strokeWidth="4" />
        <path d="M57 20v4m7-4v4m7-4v4" stroke={light} strokeWidth="1.4" />
      </>;
    case 'field_delivery_pending':
      return <>
        <path d="M43 26H32v70h68" fill="none" strokeWidth="5" />
        <path d="M45 47h42l8 43H45Z" fill={light} />
        <path d="M78 47h9l8 43H78Z" fill={mid} />
        <path d="M58 47v16h12V47" fill={paper} />
        <circle cx="37" cy="100" r="11" fill={dark} /><circle cx="37" cy="100" r="4" fill={paper} stroke="none" />
      </>;
    default:
      return <>
        <path d="M28 42h72l-6 59H34Z" fill={light} />
        <path d="M82 42h18l-6 59H78Z" fill={mid} stroke="none" />
        <rect x="23" y="32" width="82" height="13" rx="4" fill={paper} />
        <path d="M43 59v25m14-25v25m14-25v25m14-25v25" opacity=".55" />
        <rect x="52" y="34" width="24" height="8" rx="3" fill={dark} stroke="none" />
      </>;
  }
}

export default function WarehouseArtwork({ type }) {
  const artwork = WAREHOUSE_ARTWORK[type];
  return <div aria-hidden="true" className="flex min-h-44 items-center justify-center border-b border-green-900/5 px-6 py-5 sm:h-full" style={{ background: 'radial-gradient(ellipse at 50% 40%, #ffffff 0%, #f2f7ef 70%, #edf4e9 100%)' }}>
    {artwork ? <span className="block h-32 w-32 shrink-0" style={{
      background: 'linear-gradient(145deg, #28553e 15%, #487e47 85%)',
      maskImage: `url("${artwork.src}")`, WebkitMaskImage: `url("${artwork.src}")`,
      maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
      maskPosition: 'center', WebkitMaskPosition: 'center', maskMode: 'alpha',
    }} /> : <svg viewBox="0 0 128 128" width="128" height="128" className="h-32 w-32 shrink-0" fill="none" stroke="#28553e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <WarehouseObject type={type} />
    </svg>}
  </div>;
}
