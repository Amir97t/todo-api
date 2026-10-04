import { IsIn, IsOptional } from 'class-validator';

export type DeleteStrategy = 'relocate' | 'delete';

export const DELETE_STRATEGIES: DeleteStrategy[] = ['relocate', 'delete'];

export class DeleteListQueryDto {
  @IsOptional()
  @IsIn(DELETE_STRATEGIES)
  strategy?: DeleteStrategy;
}
