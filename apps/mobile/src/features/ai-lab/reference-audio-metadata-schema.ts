import { z } from "zod";
export const audioMetadata = z.object({ durationSeconds: z.number().finite().positive() });
