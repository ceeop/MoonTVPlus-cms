import { NextRequest, NextResponse } from 'next/server';

import { TVBoxAccessError, tvboxBaseUrl } from '@/lib/tvbox/access';
import { tvboxCatalog } from '@/lib/tvbox/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    return NextResponse.json(
      await tvboxCatalog(
        params.token,
        request.nextUrl.searchParams,
        tvboxBaseUrl(request)
      ),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      {
        status: error instanceof TVBoxAccessError ? error.status : 503,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }
}
