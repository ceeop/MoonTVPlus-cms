export interface TVBoxSite {
  key: string;
  name: string;
  type: number;
  api: string;
  jar?: string;
  ext?: unknown;
  searchable?: number;
  quickSearch?: number;
  filterable?: number;
  [key: string]: unknown;
}

export interface TVBoxDocument {
  spider?: string;
  sites: TVBoxSite[];
  parses?: unknown[];
  lives?: unknown[];
  rules?: unknown[];
  flags?: string[];
  ads?: string[];
  headers?: unknown[];
  doh?: unknown[];
  hosts?: string[];
}

export interface TVBoxSubscription {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  selectedSiteKeys?: string[];
  updatedAt: number;
  document: TVBoxDocument;
  assets?: TVBoxAsset[];
  assetErrors?: string[];
  assetsUpdatedAt?: number;
}

export interface TVBoxAsset {
  id: string;
  url: string;
  resolvedUrl?: string;
  name: string;
  kind: 'jar' | 'script' | 'config';
  contentType: string;
  size: number;
}

export interface TVBoxSettings {
  CatalogEnabled: boolean;
  LocalAssetsEnabled?: boolean;
  FilterCloudDrive?: boolean;
  Subscriptions: TVBoxSubscription[];
}
