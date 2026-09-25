import { Module } from '@nestjs/common';
import { RedisModule } from '../infra/redis/redis.module';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { EmergencyAccessBlockService } from './emergency-access-block.service';

@Module({
  imports: [RedisModule],
  providers: [EmergencyAccessBlockService, AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
