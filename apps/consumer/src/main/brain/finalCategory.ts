import { categoryForApp } from '../../shared/categories';
import { CONFIDENT } from './questions';

/** What a labelled read finally counts as (Today, and the eval harness's "final" score):
 * trust Laya's own choice, unless it is unsure AND the app is a *known* one — then the
 * app-name rule overrides. An unsure choice on an unrecognized app keeps Laya's guess,
 * since `categoryForApp` returning 'other' for it is not a real signal either way. */
export function finalCategory(choice: string, confidence: number, app: string): string {
  if (confidence >= CONFIDENT) return choice;
  const appRule = categoryForApp(app);
  return appRule !== 'other' ? appRule : choice;
}
