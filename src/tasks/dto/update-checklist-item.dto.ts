import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Trim } from '../../app/pipes/trim.decorator.js';

export class UpdateChecklistItemDto {
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  text?: string;

  // Real boolean only: enableImplicitConversion is off globally.
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
