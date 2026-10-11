import { z } from "zod";
export const videoMetadata = z.object({
  durationSeconds: z.number().finite().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
