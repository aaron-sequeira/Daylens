import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../main/settings';
import type { LabellingStatus } from '../../main/brain/scheduler';
import { bannerText, canRedownload, labellingText, modelHint, modelStatusText, shouldAskScreenReading } from './models';

const idle: LabellingStatus = { state: 'idle', lastLabelledAt: null, pending: 0 };
const paused: LabellingStatus = { state: 'paused', lastLabelledAt: null, pending: 25 };

describe('shouldAskScreenReading', () => {
  it('asks consented users once, and never users who already turned reading on', () => {
    expect(shouldAskScreenReading({ ...DEFAULT_SETTINGS, consentGranted: true })).toBe(true);
    expect(shouldAskScreenReading({ ...DEFAULT_SETTINGS, consentGranted: false })).toBe(false);
    expect(shouldAskScreenReading({ ...DEFAULT_SETTINGS, consentGranted: true, screenReadingAsked: true })).toBe(false);
    expect(shouldAskScreenReading({ ...DEFAULT_SETTINGS, consentGranted: true, screenReading: true })).toBe(false);
  });
});

describe('model texts', () => {
  it('describes each model state', () => {
    expect(modelStatusText({ state: 'missing' })).toBe('Not downloaded');
    expect(modelStatusText({ state: 'downloading', received: 700_000_000, total: 1_690_000_000, retrying: false })).toBe('Downloading 41% (0.7 of 1.7 GB)');
    expect(modelStatusText({ state: 'downloading', received: 0, total: 1_690_000_000, retrying: true })).toBe('Download paused, retrying…');
    expect(modelStatusText({ state: 'verifying' })).toBe('Checking…');
    expect(modelStatusText({ state: 'ready' })).toBe('Ready');
    expect(modelStatusText({ state: 'error', reason: 'no_space' })).toBe('Not enough disk space (needs about 2.2 GB free)');
    expect(modelStatusText({ state: 'error', reason: 'bad_hash' })).toBe("Download was damaged. Try 'Download again'.");
  });
  it('describes labelling', () => {
    expect(labellingText({ state: 'waiting', lastLabelledAt: null, pending: 3 })).toBe('Waiting for the model');
    expect(labellingText({ state: 'paused', lastLabelledAt: null, pending: 3 })).toBe('Paused after repeated errors');
    expect(labellingText({ state: 'idle', lastLabelledAt: null, pending: 0 })).toBe('Nothing labelled yet');
    expect(labellingText({ state: 'running', lastLabelledAt: null, pending: 30 })).toBe('Labelling now…');
  });
  it('shows a banner only while downloading with reading on', () => {
    expect(bannerText(true, { state: 'downloading', received: 845_000_000, total: 1_690_000_000, retrying: false }, idle)).toBe('Downloading the AI model: 50%');
    expect(bannerText(false, { state: 'downloading', received: 1, total: 2, retrying: false }, idle)).toBeNull();
    expect(bannerText(true, { state: 'ready' }, idle)).toBeNull();
  });
  it('tells Today why reading stopped when labelling is paused after errors', () => {
    expect(bannerText(true, { state: 'ready' }, paused)).toBe('Labelling paused after errors. See Settings → AI model.');
    expect(bannerText(false, { state: 'ready' }, paused)).toBeNull();
  });
  it('offers Download again only when the model is missing or failed', () => {
    expect(canRedownload({ state: 'missing' })).toBe(true);
    expect(canRedownload({ state: 'error', reason: 'bad_hash' })).toBe(true);
    expect(canRedownload({ state: 'error', reason: 'no_space' })).toBe(true);
    expect(canRedownload({ state: 'ready' })).toBe(false);
    expect(canRedownload({ state: 'verifying' })).toBe(false);
    expect(canRedownload({ state: 'downloading', received: 1, total: 2, retrying: true })).toBe(false);
  });
  it('hints that screen reading must be on before the model downloads', () => {
    const off = { ...DEFAULT_SETTINGS, consentGranted: true, screenReading: false };
    expect(modelHint(off, { state: 'missing' })).toBe('Turn on screen reading to download the model.');
    expect(modelHint(off, { state: 'error', reason: 'bad_hash' })).toBe('Turn on screen reading to download the model.');
    expect(modelHint(off, { state: 'ready' })).toBeNull();
    expect(modelHint({ ...off, screenReading: true }, { state: 'missing' })).toBeNull();
  });
});
