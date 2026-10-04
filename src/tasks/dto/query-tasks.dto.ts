import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Trim } from '../../app/pipes/trim.decorator.js';

export const TASK_SORTS = ['newest', 'oldest', 'az', 'za'] as const;

export type TaskSort = (typeof TASK_SORTS)[number];

export class QueryTasksDto {
  @IsOptional()
  @IsUUID()
  listId?: string;

  // Query strings arrive as text; implicit conversion is off globally, so
  // "true"/"false" must be mapped explicitly before @IsBoolean runs.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @Trim()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(TASK_SORTS)
  sort?: TaskSort;
}
