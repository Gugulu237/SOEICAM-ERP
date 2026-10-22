// SOEICAM finished goods are assemblies. Keep the historical type readable.
export const isAssemblyInventoryType = type => ['assembly', 'finished_product'].includes(type);
export const itemFormType = type => type === 'service' ? 'service' : isAssemblyInventoryType(type) ? 'assembly' : 'inventory_item';
export const inventorySubtype = type => isAssemblyInventoryType(type) ? 'finished_product' : type;
