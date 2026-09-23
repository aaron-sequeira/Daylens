// Native OS adapters. Kept out of the main index so tests and non-Electron code never load native hooks.
export { ActiveWinForegroundSource } from './tracking/activeWindow';
export { UiohookInputSource } from './tracking/inputActivity';
