import { NextResponse } from 'next/server';
import { authenticateRequest, checkOrigin, apiError } from '@/server/auth';
import { signedFile } from '@/server/files';
export const runtime = 'nodejs';
export async function POST(request) {
  try {
    checkOrigin(request);
    const context = await authenticateRequest(), { file_uri,expires_in } = await request.json();
    return NextResponse.json(await signedFile(context,file_uri,expires_in),{ headers:{ 'Cache-Control':'no-store' } });
  } catch (error) { return apiError(error); }
}
