import { z } from 'zod';

const read = z.object({ id: z.number().int(), app: z.string(), title: z.string().nullable(), text: z.string() }).strict();
export const brainRequest = z.object({ op: z.literal('label'), modelDir: z.string().min(1), reads: z.array(read).max(200) }).strict();

const conf = z.number().min(0).max(1).nullable();
const lvl = z.number().min(0).max(2).nullable();
const label = z.object({
  id: z.number().int(), category: z.string().max(40).nullable(), categoryConf: conf,
  activity: z.string().max(40).nullable(), activityConf: conf, stuck: lvl, distraction: lvl
}).strict();
// Main process trust boundary: anything the Brain sends is validated before it touches the database.
// The Brain posts one 'label' per read as soon as it is done, then 'done' (or 'error' at any point).
export const brainResponse = z.discriminatedUnion('op', [
  z.object({ op: z.literal('label'), result: label }).strict(),
  z.object({ op: z.literal('done') }).strict(),
  z.object({ op: z.literal('error'), message: z.string() }).strict()
]);

export type BrainRequest = z.infer<typeof brainRequest>;
export type BrainResponse = z.infer<typeof brainResponse>;
