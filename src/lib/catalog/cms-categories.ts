import { createHash } from 'crypto';
import { decode } from 'he';

import type { ApiSite } from '@/lib/config';
import { parseJsonLosslessIntegers } from '@/lib/json';

import type { CatalogSourceCategories, CmsCategory } from './category-config';
import {
  type CatalogKind,
  type CatalogSettings,
  classifyVideo,
  cmsUrl,
  normalizeTitle,
} from './model';

export async function fetchCmsCategories(
  site: ApiSite
): Promise<CatalogSourceCategories> {
  const response = await fetch(cmsUrl(site.api, { ac: 'list' }), {
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = parseJsonLosslessIntegers<{
    class?: Array<Record<string, unknown>>;
  }>(await response.text());
  if (!Array.isArray(data.class)) throw new Error('源站没有返回分类列表');
  const unique = new Map<string, CmsCategory>();
  data.class.forEach((item) => {
    const id = String(item.type_id ?? '').trim();
    const name = decode(String(item.type_name ?? '')).trim();
    if (id && id.length <= 80 && name && name.length <= 100)
      unique.set(id, {
        id,
        name,
        parentId:
          String(item.type_pid || '') === '0'
            ? ''
            : String(item.type_pid || ''),
      });
  });
  if (!unique.size || unique.size > 500) throw new Error('源站分类数量无效');
  return { sourceKey: site.key, categories: Array.from(unique.values()) };
}

// Refresh source snapshots while preserving edited names, enabled flags and explicit unbound selections.
export function mergeCatalogCategories(
  settings: CatalogSettings,
  catalogs: CatalogSourceCategories[],
  syncPrimary = false
): CatalogSettings {
  const primaryKey = settings.DefaultSourceKey || settings.SourceKeys[0];
  const primary = catalogs.find((catalog) => catalog.sourceKey === primaryKey);
  if (
    (settings.Categories === undefined || syncPrimary) &&
    (!primary || primary.error || !primary.categories.length)
  ) {
    throw new Error('默认源的分类读取失败，请重试或更换默认源');
  }
  const snapshots = new Map(
    (settings.SourceCategories || []).map((catalog) => [
      catalog.sourceKey,
      catalog,
    ])
  );
  catalogs.forEach((catalog) => {
    if (!catalog.error) snapshots.set(catalog.sourceKey, catalog);
  });
  const idFor = (typeId: string) =>
    'cat_' +
    createHash('sha256')
      .update(`${primaryKey}\n${typeId}`)
      .digest('hex')
      .slice(0, 24);
  const primaryIds = new Set(
    primary?.categories.map((category) => category.id)
  );
  const categoryKind = (
    category: CmsCategory,
    seen = new Set<string>()
  ): CatalogKind => {
    if (seen.has(category.id)) return 'other';
    seen.add(category.id);
    const parent = primary?.categories.find(
      (candidate) => candidate.id === category.parentId
    );
    const parentKind = parent ? categoryKind(parent, seen) : 'other';
    return parentKind !== 'other' ? parentKind : classifyVideo(category.name);
  };
  const categories =
    settings.Categories?.map((category) => ({ ...category })) ??
    (primary?.categories || []).map((category) => ({
      id: idFor(category.id),
      name: category.name,
      kind: categoryKind(category),
      parentId: primaryIds.has(category.parentId)
        ? idFor(category.parentId)
        : '',
      enabled: settings.Kinds.includes(categoryKind(category)),
    }));
  const bindings = [...(settings.CategoryBindings || [])];
  if (syncPrimary && settings.Categories !== undefined && primary) {
    // Import a newly selected default source without discarding edited categories or other bindings.
    const imported = new Map<string, string>();
    const added = new Set<string>();
    for (const sourceCategory of primary.categories) {
      const bound = bindings.find(
        (binding) =>
          binding.sourceKey === primaryKey &&
          binding.typeId === sourceCategory.id
      );
      const matching = categories.filter(
        (category) =>
          normalizeTitle(category.name) === normalizeTitle(sourceCategory.name)
      );
      let category = categories.find((entry) => entry.id === bound?.categoryId);
      if (!category && matching.length === 1) category = matching[0];
      if (!category) {
        category = {
          id: idFor(sourceCategory.id),
          name: sourceCategory.name,
          kind: categoryKind(sourceCategory),
          parentId: '',
          enabled: settings.Kinds.includes(categoryKind(sourceCategory)),
        };
        categories.push(category);
        added.add(category.id);
      }
      imported.set(sourceCategory.id, category.id);
      const binding = {
        sourceKey: primaryKey,
        typeId: sourceCategory.id,
        categoryId: category.id,
      };
      const index = bindings.findIndex(
        (entry) =>
          entry.sourceKey === primaryKey && entry.typeId === sourceCategory.id
      );
      if (index < 0) bindings.push(binding);
      else bindings[index] = binding;
    }
    for (const sourceCategory of primary.categories) {
      const category = categories.find(
        (entry) => entry.id === imported.get(sourceCategory.id)
      );
      if (category && added.has(category.id))
        category.parentId = imported.get(sourceCategory.parentId) || '';
    }
  }
  for (const catalog of Array.from(snapshots.values())) {
    if (!settings.SourceKeys.includes(catalog.sourceKey)) continue;
    for (const sourceCategory of catalog.categories) {
      if (
        bindings.some(
          (binding) =>
            binding.sourceKey === catalog.sourceKey &&
            binding.typeId === sourceCategory.id
        )
      )
        continue;
      const matching = categories.filter(
        (category) =>
          normalizeTitle(category.name) === normalizeTitle(sourceCategory.name)
      );
      const categoryId =
        settings.Categories === undefined && catalog.sourceKey === primaryKey
          ? idFor(sourceCategory.id)
          : matching.length === 1
          ? matching[0].id
          : '';
      bindings.push({
        sourceKey: catalog.sourceKey,
        typeId: sourceCategory.id,
        categoryId,
      });
    }
  }
  return {
    ...settings,
    Categories: categories,
    CategoryBindings: bindings,
    SourceCategories: Array.from(snapshots.values()).filter((catalog) =>
      settings.SourceKeys.includes(catalog.sourceKey)
    ),
  };
}
