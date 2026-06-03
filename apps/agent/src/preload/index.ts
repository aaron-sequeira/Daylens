// Minimal preload for boot; the typed API is added in a later task.
import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('worksight', {});
