import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { collectCatalog } from '@/lib/catalog/collector';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { password: string } }
) {
  const internal = process.env.CATALOG_INTERNAL_TOKEN;
  const supplied =
    request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  const suppliedBytes = Buffer.from(supplied);
  const internalBytes = Buffer.from(internal || '');
  const internalAllowed =
    !!internal &&
    suppliedBytes.length === internalBytes.length &&
    timingSafeEqual(suppliedBytes, internalBytes);
  const password = process.env.CRON_PASSWORD;
  if (!internalAllowed && (!password || params.password !== password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await collectCatalog(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
