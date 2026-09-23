export const CATEGORIES = ['work', 'learning', 'social', 'entertainment', 'communication', 'other'] as const;
export type Category = typeof CATEGORIES[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  work: 'Work', learning: 'Learning', social: 'Social', entertainment: 'Entertainment', communication: 'Communication', other: 'Other'
};

// ponytail: static name rules are the Phase 2 fallback; Laya labels screen content from Phase 4 (browsers stay "other" until then).
// First match wins, so "Steam Client WebHelper" hits entertainment before anything generic.
const RULES: [RegExp, Category][] = [
  [/visual studio|^code$|cursor|antigravity|android studio|intellij|pycharm|webstorm|rider|figma|photoshop|illustrator|blender|microsoft (word|excel|powerpoint|onenote)|^(winword|excel|powerpnt)$|notion|obsidian|terminal|command prompt|powershell|postman|docker desktop|notepad\+\+|sublime/i, 'work'],
  [/anki|kindle/i, 'learning'],
  [/discord|whatsapp|telegram|signal|messenger|instagram/i, 'social'],
  [/spotify|steam|epic games|netflix|vlc|riot client|league of legends|valorant|rocket league|deadlock|battle\.net|xbox/i, 'entertainment'],
  [/slack|teams|outlook|thunderbird|zoom|rocket\.chat|mail/i, 'communication']
];

export function displayAppName(appName: string): string {
  return appName.trim().replace(/\.exe$/i, '');
}

export function categoryForApp(appName: string): Category {
  const name = displayAppName(appName);
  for (const [re, category] of RULES) if (re.test(name)) return category;
  return 'other';
}
