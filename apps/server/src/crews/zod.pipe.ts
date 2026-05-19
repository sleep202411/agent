/**
 * ZodValidationPipe — turns Zod parse errors into 400 BadRequest with a
 * structured body the frontend can render field-by-field.
 *
 *   @Post()
 *   create(@Body(new ZodValidationPipe(CreateCrewSchema)) body: CreateCrewInput) {
 *     ...
 *   }
 *
 * On invalid input the response is:
 *   400 { message: "Validation failed", issues: [{ path, message, code }, ...] }
 */
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z, ZodError, type ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe<T extends ZodSchema> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          issues: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
        });
      }
      throw err;
    }
  }
}
