import { describe, it, expect } from 'vitest';
import type { FocusSessionRow } from '@worksight/core/types';
import { buildDayDetail, parseBrowserTitle } from './detail';

const T0 = new Date(2026, 8, 26, 9, 0).getTime();
let nextId = 1;
/** A finished session `min` minutes long, starting `at` minutes after 09:00. */
const s = (appName: string, windowTitle: string | null, at: number, min: number): FocusSessionRow => ({
  id: nextId++, appName, appPath: null, windowTitle, pid: 1, startedAt: T0 + at * 60_000, endedAt: T0 + (at + min) * 60_000,
  durationSec: min * 60, date: '2026-09-26'
} as FocusSessionRow);
const NOW = T0 + 12 * 3600_000;
const build = (sessions: FocusSessionRow[], o: { reads?: Parameters<typeof buildDayDetail>[0]['reads']; exclusions?: string[] } = {}) =>
  buildDayDetail({ sessions, reads: o.reads ?? [], now: NOW, exclusions: o.exclusions ?? [] });

describe('parseBrowserTitle', () => {
  it('strips each browser suffix form and splits site from page', () => {
    expect(parseBrowserTitle('How to center a div - Stack Overflow - Google Chrome')).toEqual({ site: 'Stack Overflow', page: 'How to center a div' });
    expect(parseBrowserTitle('Array.prototype.map() - JavaScript | MDN — Mozilla Firefox')).toEqual({ site: 'MDN Web Docs', page: 'Array.prototype.map() - JavaScript' });
    expect(parseBrowserTitle('Lofi beats - YouTube - Personal - Microsoft​ Edge')).toEqual({ site: 'YouTube', page: 'Lofi beats' });
    expect(parseBrowserTitle('React docs - GitHub and 4 more pages - Work - Microsoft​ Edge')).toEqual({ site: 'GitHub', page: 'React docs' });
    expect(parseBrowserTitle('Issues · facebook/react · GitHub - Google Chrome')).toEqual({ site: 'GitHub', page: 'Issues · facebook/react' });
    expect(parseBrowserTitle('GitHub - facebook/react: The library for web and native user interfaces. - Google Chrome'))
      .toEqual({ site: 'GitHub', page: 'facebook/react: The library for web and native user interfaces.' });
    expect(parseBrowserTitle('Lofi hip hop radio - YouTube - Aaron - Microsoft​ Edge', 'Aaron')).toEqual({ site: 'YouTube', page: 'Lofi hip hop radio' });
    expect(parseBrowserTitle('Weekly notes - Notion - Opera')).toEqual({ site: 'Notion', page: 'Weekly notes' });
    expect(parseBrowserTitle('Settings | Vivaldi - Vivaldi')).toEqual({ site: 'Vivaldi', page: 'Settings' });
    expect(parseBrowserTitle('Home / X - Google Chrome')).toEqual({ site: 'X', page: 'Home' });
  });
  it('strips a leading notification counter; a title that is just the site gives no page', () => {
    expect(parseBrowserTitle('(3) YouTube - Google Chrome')).toEqual({ site: 'YouTube', page: null });
    expect(parseBrowserTitle('(12) Big talk explained - YouTube - Google Chrome')).toEqual({ site: 'YouTube', page: 'Big talk explained' });
    expect(parseBrowserTitle('Gmail - Google Chrome')).toEqual({ site: 'Gmail', page: null });
  });
  it('gives no site when no separator is left, unless the whole title is a known site', () => {
    expect(parseBrowserTitle('The Rust Programming Language - Brave')).toBeNull();
    expect(parseBrowserTitle('localhost:5173/ - Google Chrome')).toBeNull();
    expect(parseBrowserTitle('YouTube - Google Chrome')).toEqual({ site: 'YouTube', page: null });
  });
  it('caps site names at 80 characters', () => {
    expect(parseBrowserTitle(`Post - ${'Very Long Site Name '.repeat(8)}- Google Chrome`)?.site.length).toBeLessThanOrEqual(80);
  });
  it('normalises known sites, keeps unknown ones raw, and ignores blank tabs', () => {
    expect(parseBrowserTitle('Some post : r/rust - reddit - Google Chrome')?.site).toBe('Reddit');
    expect(parseBrowserTitle('Profile - twitter - Google Chrome')?.site).toBe('X');
    expect(parseBrowserTitle('A great post - Some Blog - Google Chrome')).toEqual({ site: 'Some Blog', page: 'A great post' });
    expect(parseBrowserTitle('New Tab - Google Chrome')).toBeNull();
    expect(parseBrowserTitle('')).toBeNull();
  });
  it('trims the page to 80 characters', () => {
    expect(parseBrowserTitle(`${'x'.repeat(120)} - GitHub - Google Chrome`)?.page).toHaveLength(80);
  });
});

describe('buildDayDetail', () => {
  it('ranks apps by time (display names), rounding minutes and dropping under a minute', () => {
    const d = build([s('Code.exe', 'a.ts', 0, 30), s('Code.exe', 'b.ts', 40, 15), s('Slack.exe', 'general', 30, 10), s('Notepad.exe', 'x', 60, 0.4)]);
    expect(d.apps).toEqual([{ app: 'Code', min: 45 }, { app: 'Slack', min: 10 }]);
  });
  it('counts the latest open session up to now, and an older open one as zero', () => {
    const open = { ...s('Code.exe', 'a.ts', 0, 0), endedAt: null } as FocusSessionRow;
    const leftover = { ...s('Slack.exe', 'x', -60, 0), endedAt: null } as FocusSessionRow;
    const d = build([leftover, open]);
    expect(d.apps).toEqual([{ app: 'Code', min: 720 }]);
  });
  it('groups browser time by site with up to 3 distinct pages each, most-viewed first', () => {
    const d = build([
      s('Google Chrome', 'Q1 - Stack Overflow - Google Chrome', 0, 5), s('msedge.exe', 'Q2 - Stack Overflow - Personal - Microsoft Edge', 5, 9),
      s('firefox.exe', 'Q3 - Stack Overflow — Mozilla Firefox', 20, 2), s('Google Chrome', 'Q4 - Stack Overflow - Google Chrome', 30, 1),
      s('Google Chrome', 'Q1 - Stack Overflow - Google Chrome', 40, 1), s('Google Chrome', 'Repo - GitHub - Google Chrome', 50, 20)
    ]);
    expect(d.sites).toEqual([{ site: 'GitHub', min: 20, pages: ['Repo'] }, { site: 'Stack Overflow', min: 18, pages: ['Q2', 'Q1', 'Q3'] }]);
    expect(d.apps.map((a) => a.app)).toContain('Google Chrome');
  });
  it('lists videos from video sites, not the YouTube home page', () => {
    const d = build([
      s('Google Chrome', '(3) YouTube - Google Chrome', 0, 10), s('Google Chrome', '(3) Lofi mix - YouTube - Google Chrome', 10, 25),
      s('Google Chrome', 'Stranger Things | Netflix - Google Chrome', 40, 50), s('Google Chrome', 'Repo - GitHub - Google Chrome', 100, 5)
    ]);
    expect(d.videos).toEqual([{ title: 'Stranger Things', site: 'Netflix', min: 50 }, { title: 'Lofi mix', site: 'YouTube', min: 25 }]);
  });
  it('detects games from the known list or mostly-gaming reads, never launchers', () => {
    const reads = [0, 1, 2, 3, 4, 5].map((i) => ({ at: T0 + (70 + i) * 60_000, appName: 'Hades.exe', activity: i < 3 ? 'gaming' : 'other', category: 'entertainment' }))
      .concat([0, 1, 2, 3, 4].map((i) => ({ at: T0 + (125 + i) * 60_000, appName: 'steam.exe', activity: 'gaming', category: 'entertainment' })));
    const d = build([
      s('VALORANT-Win64-Shipping.exe', null, 0, 60), s('Hades.exe', 'Hades', 60, 30), s('steam.exe', 'Steam Big Picture', 120, 20),
      s('Code.exe', 'a.ts', 150, 40)
    ], { reads });
    expect(d.games).toEqual([{ name: 'VALORANT-Win64-Shipping', min: 60 }, { name: 'Hades', min: 30 }]);
  });
  it('finds learning from learning sites, tutorial-style videos and learning-labelled reads', () => {
    const reads = [{ at: T0 + 65 * 60_000, appName: 'Anki.exe', activity: null, category: 'learning' }];
    const d = build([
      s('Google Chrome', 'Closures - JavaScript | MDN - Google Chrome', 0, 20), s('Google Chrome', 'Rust course lesson 3 - YouTube - Google Chrome', 20, 30),
      s('Google Chrome', 'Funny cats - YouTube - Google Chrome', 50, 10), s('Anki.exe', 'Japanese deck', 60, 15)
    ], { reads });
    expect(d.learning).toEqual([
      { title: 'Rust course lesson 3', where: 'YouTube', min: 30 }, { title: 'Closures - JavaScript', where: 'MDN Web Docs', min: 20 },
      { title: 'Japanese deck', where: 'Anki', min: 15 }
    ]);
  });
  it('drops titles matching the exclusions, and private windows entirely', () => {
    const d = build([
      s('Google Chrome', 'Statement - My Bank - Google Chrome', 0, 20), s('msedge.exe', 'Secret video - YouTube - [InPrivate] - Microsoft Edge', 20, 20),
      s('Google Chrome', 'Hidden film - YouTube - Google Chrome', 40, 20), s('firefox.exe', 'Page — Mozilla Firefox Private Browsing', 60, 20),
      s('Google Chrome', 'Incognito tab - GitHub - Google Chrome', 80, 20), s('Google Chrome', 'Ok page - GitHub - Google Chrome', 100, 5)
    ], { exclusions: ['bank', 'Hidden film'] });
    expect(d.sites).toEqual([{ site: 'GitHub', min: 5, pages: ['Ok page'] }]);
    expect(d.videos).toEqual([]);
    expect(JSON.stringify(d)).not.toMatch(/Bank|Secret|Hidden|Incognito|Private/);
    expect(d.apps[0]).toEqual({ app: 'Google Chrome', min: 65 }); // app time still counts
  });
  it('drops page titles that carry an email address anywhere in the title', () => {
    const d = build([s('Google Chrome', 'Inbox (3) - someone@example.com - Gmail - Google Chrome', 0, 10),
      s('Google Chrome', 'Inbox - someone@example.com - Google Chrome', 10, 5)]);
    expect(d.sites).toEqual([{ site: 'Gmail', min: 10, pages: [] }]);
    expect(JSON.stringify(d)).not.toContain('@');
  });
  it('treats "(Private)" windows as private', () => {
    const d = build([s('Brave', 'Secret page - GitHub - Brave (Private)', 0, 10)]);
    expect(d.sites).toEqual([]);
  });
  it('counts a browser title with no site under the browser app only', () => {
    const d = build([s('Google Chrome', 'The Rust Programming Language - Google Chrome', 0, 10)]);
    expect(d.sites).toEqual([]);
    expect(d.apps).toEqual([{ app: 'Google Chrome', min: 10 }]);
  });
  it('drops a custom Edge profile name that ends every Edge title that day', () => {
    const d = build([
      s('msedge.exe', 'Lofi hip hop radio - YouTube - Aaron - Microsoft​ Edge', 0, 20),
      s('msedge.exe', 'Pull requests · facebook/react · GitHub - Aaron - Microsoft​ Edge', 20, 10),
      s('msedge.exe', 'New tab - Aaron - Microsoft​ Edge', 30, 1)
    ]);
    expect(d.videos).toEqual([{ title: 'Lofi hip hop radio', site: 'YouTube', min: 20 }]);
    expect(d.sites.map((x) => x.site)).toEqual(['YouTube', 'GitHub']);
  });
  it('does not mistake a site shared by every Edge title for a profile', () => {
    const d = build([s('msedge.exe', 'Lofi mix - YouTube - Microsoft Edge', 0, 20), s('msedge.exe', 'Jazz mix - YouTube - Microsoft Edge', 20, 10)]);
    expect(d.videos.map((v) => v.title)).toEqual(['Lofi mix', 'Jazz mix']);
  });
  it('requires 5+ reads for the gaming rule, never counts browsers, and excludes only the Steam client by exact name', () => {
    const gamingReads = (app: string, at: number, n: number) => Array.from({ length: n }, (_, i) => ({ at: T0 + (at + i) * 60_000, appName: app, activity: 'gaming', category: 'entertainment' }));
    const d = build([
      s('NewGame.exe', null, 0, 20), s('Google Chrome', 'Chess - Lichess - Google Chrome', 30, 20),
      s('steamwebhelper.exe', 'Steam', 60, 20), s('SteamWorld Dig 2.exe', null, 90, 20)
    ], { reads: [...gamingReads('NewGame.exe', 0, 4), ...gamingReads('Google Chrome', 30, 6), ...gamingReads('steamwebhelper.exe', 60, 6), ...gamingReads('SteamWorld Dig 2.exe', 90, 6)] });
    expect(d.games).toEqual([{ name: 'SteamWorld Dig 2', min: 20 }]);
  });
  it('keeps learning to known sites and docs.* hosts, never Google Docs, Word or Notion', () => {
    const learnReads = (app: string, at: number) => [{ at: T0 + at * 60_000, appName: app, activity: null, category: 'learning' }];
    const d = build([
      s('Google Chrome', 'Project plan - Google Docs - Google Chrome', 0, 20), s('Google Chrome', 'os — Python 3.12 documentation - Google Chrome', 20, 15),
      s('Google Chrome', 'Tutorial - docs.python.org - Google Chrome', 40, 10), s('WINWORD.EXE', 'Essay.docx - Word', 60, 20), s('Notion.exe', 'Study notes', 90, 20)
    ], { reads: [...learnReads('Google Chrome', 5), ...learnReads('WINWORD.EXE', 65), ...learnReads('Notion.exe', 95)] });
    expect(d.learning).toEqual([{ title: 'Tutorial', where: 'docs.python.org', min: 10 }]);
  });
  it('caps each list', () => {
    const many = Array.from({ length: 14 }, (_, i) => [
      s(`App${i}.exe`, 'x', i * 100, 20 - i), s('Google Chrome', `P${i} - Site${i} - Google Chrome`, i * 100 + 30, 20 - i),
      s('Google Chrome', `Video ${i} - YouTube - Google Chrome`, i * 100 + 60, 20 - i), s(`Game${i}.exe`, null, i * 100 + 90, 5)
    ]).flat();
    const reads = Array.from({ length: 14 * 5 }, (_, k) => ({ at: T0 + (Math.floor(k / 5) * 100 + 90 + (k % 5)) * 60_000, appName: `Game${Math.floor(k / 5)}.exe`, activity: 'gaming', category: 'entertainment' }));
    const tut = Array.from({ length: 10 }, (_, i) => s('Google Chrome', `Tutorial ${i} - YouTube - Google Chrome`, 2000 + i * 10, 3));
    const d = build([...many, ...tut], { reads });
    expect(d.apps).toHaveLength(10);
    expect(d.sites).toHaveLength(10);
    expect(d.videos).toHaveLength(10);
    expect(d.games).toHaveLength(8);
    expect(d.learning).toHaveLength(8);
    expect(d.videos[0]).toEqual({ title: 'Video 0', site: 'YouTube', min: 20 });
  });
});
