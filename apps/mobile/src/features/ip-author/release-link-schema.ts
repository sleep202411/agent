import { z } from "zod";
export const releaseLink = z.object({
  label: z.string().trim().min(1).max(80),
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    }, "Use an HTTPS link without embedded credentials."),
});
export const releaseLinks = z
  .array(releaseLink)
  .max(20)
  .refine(
    (items) => new Set(items.map((item) => item.url)).size === items.length,
    "Remove duplicate release links."
  );
