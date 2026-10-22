
/* localized-interface */
import { ui } from './i18n.js';
// Titles follow the supplied PNG filenames; operational warehouse IDs/types
// and individual location names remain intact.
export const WAREHOUSE_ARTWORK = {
  raw_material: { get title(){return ui("Raw Materials");}, src: '/warehouse/raw-materials.png', source: 'raw-materials.png' },
  packaging: { get title(){return ui("Packaging");}, src: '/warehouse/packaging.png', source: 'Packaging.png' },
  cold_room: { get title(){return ui("Cold Room");}, src: '/warehouse/cold-room.png', source: 'cold-room.png' },
  wip: { get title(){return ui("Fermentation Tank");}, src: '/warehouse/fermentation-tank.png', get source(){return ui("Fermentation Tank.png");} },
  quarantine: { get title(){return ui("Quality Assurance");}, src: '/warehouse/quality-assurance.png', source: 'quality-assurance.png' },
  damaged: { get title(){return ui("Expired Products");}, src: '/warehouse/expired-products.png', get source(){return ui("Expired Products.png");} },
  commercial_custody: { get title(){return ui("Commercial Agents");}, src: '/warehouse/commercials.png', source: 'commercials.png' },
  vehicle: { get title(){return ui("Delivery Van");}, src: '/warehouse/delivery-van.png', get source(){return ui("Delivery Van.png");} },
};

export function warehousePresentation(warehouse) {
  const artwork = WAREHOUSE_ARTWORK[warehouse.warehouse_type];
  const title = artwork?.title || warehouse.name;
  const location = warehouse.warehouse_type === 'commercial_custody'
    ? warehouse.custodian_name || String(warehouse.name || '').replace(/^custody\s*[—–:-]\s*/i, '')
    : warehouse.name;
  return { title, subtitle: location && location !== title ? location : '', artwork };
}
