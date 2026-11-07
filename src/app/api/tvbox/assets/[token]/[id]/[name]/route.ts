import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import {
  authorizeTVBox,
  TVBoxAccessError,
  tvboxBaseUrl,
} from '@/lib/tvbox/access';
import { readTVBoxAsset } from '@/lib/tvbox/assets';
import { tvboxSettings } from '@/lib/tvbox/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string; id: string; name: string } }
) {
  try {
    await authorizeTVBox(params.token);
    if (!/^[a-f0-9]{64}$/.test(params.id))
      return new NextResponse(null, { status: 404 });
    const settings = tvboxSettings(await getConfig());
    for (const subscription of settings.Subscriptions.filter(
      (entry) => entry.enabled
    )) {
      const asset = subscription.assets?.find(
        (entry) => entry.id === params.id && entry.name === params.name
      );
      if (!asset) continue;
      const data = await readTVBoxAsset(
        asset,
        subscription,
        tvboxBaseUrl(request),
        params.token
      );
      return new NextResponse(new Uint8Array(data), {
        headers: {
          'Content-Type': asset.contentType,
          'Cache-Control': 'private, no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    }
    return new NextResponse(null, { status: 404 });
  } catch (error) {
    return new NextResponse(null, {
      status: error instanceof TVBoxAccessError ? error.status : 404,
    });
  }
}
