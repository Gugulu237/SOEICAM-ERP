import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { serviceEntities } from '@/server/entities';
import { transaction } from '@/server/db';
import { saveItem } from '@/server/domain/item-save';
export const runtime = 'nodejs';
export async function POST(request) {
  try {
    checkOrigin(request);
    const context = await authenticateRequest('inventory'), text = await request.text();
    if (text.length>2_000_000) throw new Error('The request is too large.');
    const input = JSON.parse(text);
    const saved = await transaction(()=>saveItem(context,serviceEntities,input));
    return Response.json(saved,{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return apiError(error); }
}
