import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";

/**
 * Central compatibility wrapper for the current zod 3.25 + resolver 5.x type
 * split. Runtime behavior is still the official zodResolver; this keeps form
 * modules from scattering version casts.
 */
export function typedZodResolver<TFieldValues extends FieldValues>(
  schema: unknown
): Resolver<TFieldValues> {
  return zodResolver(schema as never) as Resolver<TFieldValues>;
}
