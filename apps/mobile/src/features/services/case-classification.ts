import { z } from "zod";
export const caseCategories = ["copyright", "payment", "violation", "harassment", "other"] as const;
export const caseResolutions = ["payment_allocation", "warning", "takedown"] as const;
export const caseCategory = z.enum(caseCategories);
export const caseResolution = z.enum(caseResolutions);
