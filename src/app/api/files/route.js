import { NextResponse } from 'next/server';
import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { uploadFile, MAX_FILE_SIZE } from '@/server/files';
export const runtime = 'nodejs';
export async function POST(request) {
  try {
    checkOrigin(request);
    const context = await authenticateRequest();
    if (Number(request.headers.get('content-length')) > MAX_FILE_SIZE + 1024 * 1024) return NextResponse.json({ error:'File is too large.' },{ status:413 });
    const form = await request.formData();
    return NextResponse.json(await uploadFile(context,form.get('file'),form.get('private') === 'true'),{ headers:{ 'Cache-Control':'no-store' } });
  } catch (error) { return apiError(error); }
}
