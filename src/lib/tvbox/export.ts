import { localizeTVBoxDocument } from './assets';
import { cloudDriveReason } from './cloud-filter';
import { tvboxSourceUrl } from './source-url';
import { isCMSImportable, mergeTVBoxSubscriptions } from './subscriptions';
import type { TVBoxSettings } from './types';

export function exportTVBoxSubscriptions(
  settings: TVBoxSettings,
  existing: string[],
  base: string,
  token: string,
  adFilter: boolean,
  yellowFilter: boolean,
  m3u8Only = false
) {
  return mergeTVBoxSubscriptions(
    {
      ...settings,
      Subscriptions: settings.Subscriptions.map((subscription) => {
        const document =
          settings.LocalAssetsEnabled !== false
            ? localizeTVBoxDocument(subscription, base, token)
            : subscription.document;
        return {
          ...subscription,
          document: {
            ...document,
            sites: document.sites
              .filter(
                (site) =>
                  (!m3u8Only || isCMSImportable(site)) &&
                  (settings.FilterCloudDrive === false ||
                    !cloudDriveReason(site))
              )
              .map((site) => {
                if (site.type !== 1 || !/^https?:\/\//i.test(site.api))
                  return site;
                return {
                  ...site,
                  api: tvboxSourceUrl(base, token, subscription.id, site.key, {
                    adFilter,
                    yellowFilter,
                    cloudFilter: settings.FilterCloudDrive !== false,
                  }),
                };
              }),
          },
        };
      }),
    },
    existing
  );
}
