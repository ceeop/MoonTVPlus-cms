import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { catalogScope } from '@/lib/catalog/model';
import { catalogContext } from '@/lib/catalog/service';
import { getCatalogStore } from '@/lib/catalog/store';
import { getAvailableApiSites } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = getAuthInfoFromCookie(request);
  if (!auth?.username)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!/^[a-f0-9]{64}$/.test(params.id))
    return new NextResponse(null, { status: 404 });
  try {
    // Include all sources the viewer may access; posters also appear in special-source search results.
    const { config, settings, sites } = await catalogContext(auth.username);
    if (!settings.Enabled) return new NextResponse(null, { status: 404 });
    const specialSites = (
      await getAvailableApiSites(auth.username, true)
    ).filter((site) => settings.SourceKeys.includes(site.key));
    const image = await getCatalogStore().poster(
      params.id,
      [...sites, ...specialSites],
      {
        ...catalogScope(settings),
        excludeRestricted: !config.SiteConfig.DisableYellowFilter,
      }
    );
    if (!image)
      return new NextResponse(null, {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    return new NextResponse(new Uint8Array(image.data), {
      headers: {
        'Content-Type': image.contentType,
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
