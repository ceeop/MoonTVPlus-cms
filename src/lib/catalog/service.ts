import { getAvailableApiSites, getConfig } from '@/lib/config';
import { yellowWords } from '@/lib/yellow';

import { catalogScope, catalogSettings } from './model';
import { CatalogQuery, getCatalogStore } from './store';

export async function catalogContext(username: string, specialOnly = false) {
  const config = await getConfig(true);
  const settings = catalogSettings(config);
  const available = await getAvailableApiSites(username, specialOnly);
  return {
    config,
    settings,
    sites: available.filter((site) => settings.SourceKeys.includes(site.key)),
  };
}

export async function localCatalogSearch(
  username: string,
  query: string,
  specialOnly = false
) {
  const { config, settings, sites } = await catalogContext(
    username,
    specialOnly
  );
  if (!settings.Enabled) return null;
  const results = await getCatalogStore().search(sites, {
    query,
    ...catalogScope(settings, config.SiteConfig.M3u8Only === true),
    excludeRestricted: !config.SiteConfig.DisableYellowFilter,
  });
  return results
    .filter(
      (item) =>
        config.SiteConfig.DisableYellowFilter ||
        !yellowWords.some((word) => (item.type_name || '').includes(word))
    )
    .map((item) => ({
      ...item,
      weight:
        config.SourceConfig.find((site) => site.key === item.source)?.weight ||
        0,
    }));
}

export async function browseCatalog(
  username: string,
  options: CatalogQuery,
  specialOnly = false
) {
  const { config, settings, sites } = await catalogContext(
    username,
    specialOnly
  );
  if (!settings.Enabled)
    return {
      enabled: false,
      results: [],
      total: 0,
      page: 1,
      pageCount: 0,
      years: [],
      areas: [],
      categories: [],
    };
  return {
    enabled: true,
    categoryMode: settings.Categories !== undefined,
    ...(await getCatalogStore().browse(sites, {
      ...options,
      ...catalogScope(settings, config.SiteConfig.M3u8Only === true),
      excludeRestricted: !config.SiteConfig.DisableYellowFilter,
    })),
  };
}

export async function catalogNavigation(username: string, specialOnly = false) {
  const { config, settings, sites } = await catalogContext(
    username,
    specialOnly
  );
  return {
    enabled: settings.Enabled,
    categoryMode: settings.Categories !== undefined,
    categories: settings.Enabled
      ? await getCatalogStore().navigation(sites, {
          ...catalogScope(settings, config.SiteConfig.M3u8Only === true),
          excludeRestricted: !config.SiteConfig.DisableYellowFilter,
        })
      : [],
  };
}
