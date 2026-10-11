import { Module } from '@nestjs/common';
import { PingController } from './ping.controller.js';

@Module({
  controllers: [PingController],
  providers: [],
})
export class AppModule {}