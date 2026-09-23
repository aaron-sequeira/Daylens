import { describe, it, expect } from 'vitest';
import { categoryForApp, displayAppName } from './categories';

describe('categoryForApp', () => {
  it.each([
    ['Visual Studio Code', 'work'], ['Code.exe', 'work'], ['Windows Terminal Host', 'work'], ['Android Studio', 'work'],
    ['Antigravity IDE', 'work'], ['Figma', 'work'], ['Microsoft Excel', 'work'], ['Docker Desktop', 'work'],
    ['Anki', 'learning'],
    ['Discord', 'social'], ['WhatsApp', 'social'], ['Telegram Desktop', 'social'],
    ['Steam Client WebHelper', 'entertainment'], ['Spotify', 'entertainment'], ['Riot Client', 'entertainment'], ['deadlock.exe', 'entertainment'], ['Rocket League', 'entertainment'],
    ['Microsoft Outlook', 'communication'], ['Slack', 'communication'], ['Microsoft Teams', 'communication'], ['Zoom Workplace', 'communication'], ['Rocket.Chat', 'communication'],
    ['Google Chrome', 'other'], ['Windows Explorer', 'other'], ['SnippingTool.exe', 'other']
  ])('%s → %s', (app, cat) => {
    expect(categoryForApp(app)).toBe(cat);
  });
});

describe('displayAppName', () => {
  it('strips a trailing .exe and whitespace', () => {
    expect(displayAppName('deadlock.exe ')).toBe('deadlock');
    expect(displayAppName('Google Chrome')).toBe('Google Chrome');
  });
});
