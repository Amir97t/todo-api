import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Trim } from '../../app/pipes/trim.decorator.js';

export class UpdateTaskDto {
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @Trim()
  @IsString()
  description?: string | null;

  // Real booleans only: enableImplicitConversion is off globally, so a JSON
  // string like "true" fails here instead of being coerced.
  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsUUID()
  listId?: string;
}
