import { z } from 'zod';

export const writerRequest = z.object({
  op: z.literal('write'), modelPath: z.string().min(1), gpu: z.enum(['auto', 'off']),
  schema: z.record(z.unknown()), system: z.string(), user: z.string(),
  maxTokens: z.number().int().min(16).max(4096), contextSize: z.number().int().min(1024).max(32768)
}).strict();
// Main process trust boundary: anything the writer sends is validated before use.
export const writerResponse = z.discriminatedUnion('op', [
  z.object({ op: z.literal('written'), json: z.unknown() }).strict(),
  z.object({ op: z.literal('error'), message: z.string() }).strict()
]);
export type WriterRequest = z.infer<typeof writerRequest>;
