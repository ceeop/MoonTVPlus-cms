interface Category {
  id: string;
  name: string;
  kind: string;
  parentId: string;
}

let pending: Promise<Array<Category & { href: string }>> | undefined;

export async function loadCatalogNavigation(signal: AbortSignal) {
  if (signal.aborted)
    throw new DOMException('已取消分类导航加载', 'AbortError');
  if (!pending) {
    // Desktop and mobile navigation mount together. Share only the in-flight
    // request so permissions/settings are rechecked on subsequent navigation.
    const request = fetch('/api/catalog?view=navigation', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('分类导航加载失败');
        const data = await response.json();
        const categories: Category[] = data.categories || [];
        const ids = new Set(categories.map((category) => category.id));
        return categories
          .filter(
            (category) => !category.parentId || !ids.has(category.parentId)
          )
          .map((category) => ({
            ...category,
            href: `/catalog?${
              data.categoryMode ? 'category' : 'kind'
            }=${encodeURIComponent(category.id)}`,
          }));
      })
      .finally(() => {
        if (pending === request) pending = undefined;
      });
    pending = request;
  }
  const categories = await pending;
  // Unmounting either consumer must not cancel the other consumer's request.
  if (signal.aborted)
    throw new DOMException('已取消分类导航加载', 'AbortError');
  return categories;
}
