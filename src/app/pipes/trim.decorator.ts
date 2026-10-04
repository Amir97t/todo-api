import { Transform } from 'class-transformer';

/**
 * Runs during ValidationPipe's plainToInstance step, so validation and the
 * value stored by the service both see the trimmed string.
 */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
