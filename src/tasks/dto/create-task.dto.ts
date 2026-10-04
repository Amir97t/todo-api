import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../app/pipes/trim.decorator.js';
import { CreateChecklistItemDto } from './create-checklist-item.dto.js';

export class CreateTaskDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @Trim()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsUUID()
  listId!: string;

  // ISO-8601 only. Epoch-millisecond numbers and numeric strings are rejected
  // so legacy timestamps must be converted by the caller before sending.
  @IsOptional()
  @IsDateString()
  createdAt?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChecklistItemDto)
  checklist?: CreateChecklistItemDto[];
}
