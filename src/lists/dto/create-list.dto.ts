import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Trim } from '../../app/pipes/trim.decorator.js';
import { LIST_ICONS } from '../list-icons.js';

export class CreateListDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @IsIn(LIST_ICONS)
  icon?: string;
}
