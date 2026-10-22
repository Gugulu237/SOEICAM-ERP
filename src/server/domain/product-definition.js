import { isAssemblyInventoryType } from '../../lib/item-types.js';
import { ITEM_ACCOUNT_FIELDS } from '../../lib/item-accounts.js';
import { validateItemDefinition } from './item-settings.js';
import { validateProductComponents } from './assembly-components.js';
import { finishedItemSetupIssues } from '../../lib/item-readiness.js';

const needsComponents = input => ['components', 'inventory_type', 'purchase_price'].some(key => Object.hasOwn(input, key));
const incompleteDraft = () => new Error('Complete the assembly components, Unit of Measure, posting accounts and positive selling price before activating this catalogue draft');

// Storefront imports intentionally contain only catalogue information. Their
// lifecycle is derived from checked ERP setup, never from a client status flag.
export async function prepareProductDefinition(stores, input, existing = null, options = {}) {
  if (Object.hasOwn(input, 'configuration_status')) throw new Error('Item configuration status is managed automatically when the assembly setup is complete');
  const activatingAssembly=existing?.is_active===false&&input.is_active===true&&isAssemblyInventoryType(input.inventory_type ?? existing.inventory_type);
  if (existing?.configuration_status !== 'draft'&&!activatingAssembly) {
    let definition = await validateItemDefinition(stores, input, existing, options);
    const checkComponents = existing ? needsComponents(definition) : Object.hasOwn(definition, 'components') || Object.hasOwn(definition, 'purchase_price') || isAssemblyInventoryType(definition.inventory_type);
    if (checkComponents) definition = await validateProductComponents(stores, definition, existing);
    return definition;
  }
  if (Object.hasOwn(input, 'inventory_type') && !isAssemblyInventoryType(input.inventory_type)) throw new Error('Complete this finished product as an inventory assembly');
  const combined = { ...existing, ...input };
  const complete = isAssemblyInventoryType(combined.inventory_type)&&finishedItemSetupIssues(combined).length===0;
  if (!complete) {
    if (input.is_active === true) throw incompleteDraft();
    let definition = await validateItemDefinition(stores, input, existing, { ...options, partialUnitAccounts: true });
    if (Object.hasOwn(definition, 'components')) {
      if (!Array.isArray(definition.components)) throw new Error('Assembly components must be a list');
      if (definition.components.length) definition = await validateProductComponents(stores, definition, existing);
    }
    return { ...definition, inventory_type: 'assembly', configuration_status: 'draft', is_active: false };
  }
  // Validate the combined definition, even on a bare activation request. This
  // checks fresh account status, component references, cycles, units and costs.
  const required = Object.fromEntries(['inventory_type', 'unit_of_measure', 'selling_price', ...ITEM_ACCOUNT_FIELDS.map(({ field }) => field)].map(field => [field, combined[field]]));
  const checked = await validateItemDefinition(stores, { ...input, ...required }, existing, options);
  const assembly = await validateProductComponents(stores, { ...checked, components: combined.components }, existing);
  return { ...assembly, inventory_type: 'assembly', ...(existing.configuration_status==='draft'?{configuration_status:'ready'}:{}), is_active: input.is_active ?? existing.is_active ?? false };
}
