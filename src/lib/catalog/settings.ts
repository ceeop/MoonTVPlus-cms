import { createHash } from 'crypto';
import { z } from 'zod';

import { activeCatalogBindings } from './category-config';
import type { CatalogSettings } from './model';
import { catalogSettings } from './model';

const taxonomyFields = [
  'Categories',
  'CategoryBindings',
  'SourceCategories',
] as const;

export function catalogTaxonomyRevision(settings: CatalogSettings): string {
  return createHash('sha256')
    .update(JSON.stringify(taxonomyFields.map((key) => settings[key])))
    .digest('hex');
}

export function mergeCollectionSettings(
  current: CatalogSettings,
  draft: Record<string, unknown>
) {
  return parseCatalogSettings({
    ...current,
    Enabled: draft.Enabled,
    SourceKeys: draft.SourceKeys,
    DefaultSourceKey: draft.DefaultSourceKey,
    IntervalMinutes: draft.IntervalMinutes,
    ...(draft.CleanupEnabled !== undefined
      ? { CleanupEnabled: draft.CleanupEnabled }
      : {}),
    ...(draft.RetentionMonths !== undefined
      ? { RetentionMonths: draft.RetentionMonths }
      : {}),
    Kinds: draft.Kinds,
    ...(draft.CollectionCategoryIds !== undefined
      ? { CollectionCategoryIds: draft.CollectionCategoryIds }
      : {}),
  });
}

export function mergeTaxonomySettings(
  current: CatalogSettings,
  draft: Record<string, unknown>
): CatalogSettings {
  const patch = Object.fromEntries(
    taxonomyFields
      .filter((key) => Object.prototype.hasOwnProperty.call(draft, key))
      .map((key) => [key, draft[key]])
  );
  const candidate = { ...current, ...patch, Enabled: false };
  if (
    candidate.CollectionCategoryIds !== undefined &&
    Array.isArray(candidate.Categories)
  ) {
    const ids = new Set(candidate.Categories.map((category) => category.id));
    candidate.CollectionCategoryIds = candidate.CollectionCategoryIds.filter(
      (id) => ids.has(id)
    );
  }
  const settings = parseCatalogSettings(candidate);
  return { ...settings, Enabled: current.Enabled };
}

const kind = z.enum(['movie', 'tv', 'anime', 'variety', 'other']);
const id = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[\w-]+$/);
const cmsCategory = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  parentId: z.string().max(80),
});
const schema = z.object({
  Enabled: z.boolean(),
  SourceKeys: z.array(z.string().min(1).max(200)).max(40),
  DefaultSourceKey: z.string().max(200).optional(),
  IntervalMinutes: z.number().finite().min(5).max(1440),
  CleanupEnabled: z.boolean().optional(),
  RetentionMonths: z.number().int().min(1).max(120).optional(),
  Kinds: z.array(kind).max(5).optional(),
  Categories: z
    .array(
      z.object({
        id,
        name: z.string().trim().min(1).max(100),
        parentId: z.string().max(96),
        kind,
        enabled: z.boolean(),
      })
    )
    .max(500)
    .optional(),
  CollectionCategoryIds: z.array(id).max(500).optional(),
  CategoryBindings: z
    .array(
      z.object({
        sourceKey: z.string().min(1).max(200),
        typeId: z.string().min(1).max(80),
        categoryId: z.string().max(96),
      })
    )
    .max(20000)
    .optional(),
  SourceCategories: z
    .array(
      z.object({
        sourceKey: z.string().min(1).max(200),
        categories: z.array(cmsCategory).max(500),
      })
    )
    .max(40)
    .optional(),
});

export function parseCatalogSettings(value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) {
    if (
      result.error.issues.some((issue) => issue.path[0] === 'RetentionMonths')
    )
      throw new Error('保留时长需为 1–120 的整数月数');
    if (result.error.issues.some((issue) => issue.path[0] === 'CleanupEnabled'))
      throw new Error('定时清理开关无效');
    throw new Error(
      '配置无效：最多选择 40 个源，间隔为 5–1440 分钟，分类名称需填写完整'
    );
  }
  if (
    result.data.DefaultSourceKey &&
    !result.data.SourceKeys.includes(result.data.DefaultSourceKey)
  )
    throw new Error('默认源必须是已选择的采集源');
  const settings = catalogSettings({ CatalogConfig: result.data });
  if (settings.Enabled && !settings.SourceKeys.length)
    throw new Error('请至少选择一个采集源');
  if (settings.Categories === undefined) {
    if (settings.Enabled && !settings.Kinds.length)
      throw new Error('请至少选择一种采集类型');
    return settings;
  }
  const categories = new Map(
    settings.Categories.map((category) => [category.id, category])
  );
  if (categories.size !== settings.Categories.length)
    throw new Error('系统分类标识重复');
  if (settings.CollectionCategoryIds?.some((id) => !categories.has(id)))
    throw new Error('采集范围包含已删除的分类，请刷新后重试');
  for (const category of Array.from(categories.values())) {
    const seen = new Set<string>();
    let current: typeof category | undefined = category;
    while (current) {
      if (seen.has(current.id) || seen.size > 12)
        throw new Error('分类层级存在循环或超过 12 层');
      seen.add(current.id);
      if (!current.parentId) break;
      current = categories.get(current.parentId);
      if (!current) throw new Error('上级分类不存在');
    }
  }
  const bindingKeys = new Set<string>();
  for (const binding of settings.CategoryBindings || []) {
    const key = JSON.stringify([binding.sourceKey, binding.typeId]);
    if (bindingKeys.has(key)) throw new Error('同一源分类只能绑定一个系统分类');
    bindingKeys.add(key);
    if (binding.categoryId && !categories.has(binding.categoryId))
      throw new Error('绑定的系统分类不存在');
  }
  if (
    settings.Enabled &&
    !activeCatalogBindings(settings).some((binding) =>
      settings.SourceKeys.includes(binding.sourceKey)
    )
  )
    throw new Error('请至少启用一个分类并绑定所选源的分类');
  return settings;
}
