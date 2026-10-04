import { IsNotEmpty, IsString } from 'class-validator';
import { Trim } from '../../app/pipes/trim.decorator.js';

export class CreateChecklistItemDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  text!: string;
}
