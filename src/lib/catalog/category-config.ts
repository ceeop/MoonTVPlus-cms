import type { CatalogKind } from './model';

export interface CatalogCategory {
  id: string;
  name: string;
  kind: CatalogKind;
  parentId: string;
  enabled: boolean;
}

export interface CatalogCategoryBinding {
  sourceKey: string;
  typeId: string;
  categoryId: string;
}

export interface CmsCategory {
  id: string;
  name: string;
  parentId: string;
}

export interface CatalogSourceCategories {
  sourceKey: string;
  categories: CmsCategory[];
  error?: string;
}

export interface CatalogCategoryConfig {
  Categories?: CatalogCategory[];
  CategoryBindings?: CatalogCategoryBinding[];
  SourceCategories?: CatalogSourceCategories[];
  CollectionCategoryIds?: string[];
}

export function collectedCatalogCategories(
  config: CatalogCategoryConfig
): CatalogCategory[] {
  const active = activeCatalogCategories(config);
  if (config.CollectionCategoryIds === undefined) return active;
  const selected = new Set(config.CollectionCategoryIds);
  return active.filter((category) => selected.has(category.id));
}

export function removeCatalogCategory<T extends CatalogCategoryConfig>(
  config: T,
  id: string
): T {
  const removed = config.Categories?.find((category) => category.id === id);
  if (!removed) return config;
  return {
    ...config,
    Categories: config.Categories?.filter((category) => category.id !== id).map(
      (category) =>
        category.parentId === id
          ? {
              ...category,
              parentId: removed.parentId,
              enabled: category.enabled && removed.enabled,
            }
          : category
    ),
    CategoryBindings: config.CategoryBindings?.map((binding) =>
      binding.categoryId === id ? { ...binding, categoryId: '' } : binding
    ),
    ...(config.CollectionCategoryIds !== undefined
      ? {
          CollectionCategoryIds: config.CollectionCategoryIds.filter(
            (categoryId) => categoryId !== id
          ),
        }
      : {}),
  };
}

export function activeCatalogCategories(
  config: CatalogCategoryConfig
): CatalogCategory[] {
  const categories = config.Categories || [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  return categories.filter((category) => {
    const visited = new Set<string>();
    let current: CatalogCategory | undefined = category;
    while (current) {
      if (!current.enabled || visited.has(current.id)) return false;
      visited.add(current.id);
      if (!current.parentId) return true;
      current = byId.get(current.parentId);
    }
    return false;
  });
}

export function catalogCategoryIds(
  config: CatalogCategoryConfig,
  parentId: string
): string[] {
  const active = activeCatalogCategories(config);
  const ids = new Set(
    active.some((category) => category.id === parentId) ? [parentId] : []
  );
  for (let index = 0; index < active.length; index++) {
    let changed = false;
    active.forEach((category) => {
      if (ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return Array.from(ids);
}

export function activeCatalogBindings(
  config: CatalogCategoryConfig
): CatalogCategoryBinding[] {
  const active = new Set(
    collectedCatalogCategories(config).map((category) => category.id)
  );
  return (config.CategoryBindings || []).filter((binding) =>
    active.has(binding.categoryId)
  );
}

export function categoryCollectionPolicy(
  config: CatalogCategoryConfig,
  source?: string
): string {
  if (config.Categories === undefined) return 'legacy';
  return JSON.stringify({
    categories: activeCatalogCategories(config)
      .map(({ id, parentId, kind }) => [id, parentId, kind])
      .sort(),
    bindings: activeCatalogBindings(config)
      .filter((binding) => !source || binding.sourceKey === source)
      .map(({ sourceKey, typeId, categoryId }) => [
        sourceKey,
        typeId,
        categoryId,
      ])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
}

export function catalogCategoryScope(config: CatalogCategoryConfig) {
  return {
    categoryConfig: config.Categories === undefined ? undefined : config,
  };
}
