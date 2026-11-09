import { reviewedVideoTitles } from './video-title-aliases';

const chineseSeasons =
  '一 二 三 四 五 六 七 八 九 十 十一 十二 十三 十四 十五 十六 十七 十八 十九 二十'.split(
    ' '
  );

const chineseSeasonAliases = chineseSeasons.map(
  (number, index) => [`第${number}季`, `第${index + 1}季`] as const
);

// Keep each group small so catalog SQL can apply it on SQLite derivatives.
export const seasonTitleAliasGroups: ReadonlyArray<
  ReadonlyArray<readonly [string, string]>
> = [
  chineseSeasonAliases.slice(0, 10),
  [...chineseSeasonAliases.slice(10), ['第两季', '第2季'], ['第兩季', '第2季']],
  Array.from({ length: 9 }, (_, index) => {
    const number = index + 1;
    return [`第0${number}季`, `第${number}季`] as const;
  }),
];

function normalizeVideoSeason(title: string): string {
  if (!/第.*季/.test(title)) return title;
  const aliases = seasonTitleAliasGroups.find((group) =>
    group.some(([label]) => title.includes(label))
  );
  return (
    aliases?.reduce(
      (result, [from, to]) => result.split(from).join(to),
      title
    ) ?? title
  );
}

const titleSeparators = new RegExp('[\\s\\p{P}\\p{S}]', 'gu');
// Stray zero-width spaces, direction marks and BOMs are common in pasted CMS titles.
export const invisibleVideoTitleChars = '\u200b\u200e\u200f\u2060\ufeff';
const invisibleVideoTitlePattern = new RegExp(
  `[${invisibleVideoTitleChars}]`,
  'g'
);

export function normalizeVideoTitle(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(titleSeparators, '');
}

export const animatedComicSuffix = '动态漫';

function normalizeTitleSpelling(title: string): string {
  const visible = normalizeVideoTitle(title).replace(
    invisibleVideoTitlePattern,
    ''
  );
  return normalizeVideoSeason(
    visible.endsWith(animatedComicSuffix) ? `${visible}画` : visible
  );
}

export const verifiedVideoTitleAliases = new Map(
  reviewedVideoTitles.map(([alias, canonical]) => [
    normalizeTitleSpelling(alias),
    normalizeTitleSpelling(canonical),
  ])
);

const verifiedCanonicalTitles = new Set(verifiedVideoTitleAliases.values());

export function videoTitleMatchKey(title: string): string {
  const normalized = normalizeTitleSpelling(title);
  return verifiedVideoTitleAliases.get(normalized) || normalized;
}

export function isVerifiedVideoTitle(title: string): boolean {
  return verifiedCanonicalTitles.has(title);
}
