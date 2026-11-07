import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { catalogScope } from '@/lib/catalog/model';
import {
  browseCatalog,
  catalogContext,
  catalogNavigation,
} from '@/lib/catalog/service';
import { getCatalogStore } from '@/lib/catalog/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = getAuthInfoFromCookie(request);
  if (!auth?.username)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const p = request.nextUrl.searchParams;
  try {
    if (p.get('view') === 'navigation') {
      return NextResponse.json(
        await catalogNavigation(auth.username, p.get('special') === '1'),
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    const options = {
      query: (p.get('q') || '').slice(0, 40),
      kind: p.get('kind') || '',
      categoryId: p.get('category') || '',
      year: p.get('year') || '',
      area: p.get('area') || '',
      page: Number(p.get('page')) || 1,
      limit: Number(p.get('limit')) || 30,
      order: p.get('order') || '',
      workId: p.get('work') || '',
    };
    if (options.workId) {
      const { config, settings, sites } = await catalogContext(
        auth.username,
        p.get('special') === '1'
      );
      const resources = settings.Enabled
        ? await getCatalogStore().search(sites, {
            workId: options.workId,
            limit: 500,
            ...catalogScope(settings, config.SiteConfig.M3u8Only === true),
            excludeRestricted: !config.SiteConfig.DisableYellowFilter,
          })
        : [];
      return NextResponse.json(
        { resources },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    return NextResponse.json(
      await browseCatalog(auth.username, options, p.get('special') === '1'),
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 503 }
    );
  }
}
