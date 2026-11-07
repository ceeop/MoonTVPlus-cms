import { NextRequest, NextResponse } from 'next/server';

import { catalogScope } from '@/lib/catalog/model';
import { getCatalogStore } from '@/lib/catalog/store';
import { TVBoxAccessError, tvboxCatalogContext } from '@/lib/tvbox/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string; id: string } }
) {
  try {
    const { config, settings, sites } = await tvboxCatalogContext(params.token);
    if (!/^[a-f0-9]{64}$/.test(params.id))
      return new NextResponse(null, { status: 404 });
    const image = await getCatalogStore().poster(params.id, sites, {
      ...catalogScope(settings),
      excludeRestricted: !config.SiteConfig.DisableYellowFilter,
    });
    if (!image) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(image.data), {
      headers: {
        'Content-Type': image.contentType,
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return new NextResponse(null, {
      status: error instanceof TVBoxAccessError ? error.status : 503,
    });
  }
}
