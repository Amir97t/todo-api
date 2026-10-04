import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChecklistItemDto)
  checklist?: CreateChecklistItemDto[];
}
