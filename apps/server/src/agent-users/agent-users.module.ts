import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth';
import { ServiceTokenGuard } from '../internal/service-token.guard';
import { IpCommerceModule } from '../ip-commerce';
import { AgentUserRunnerService } from './agent-user-runner.service';
import { AgentUsersAdminController } from './agent-users-admin.controller';
import { AgentUsersInternalController } from './agent-users-internal.controller';
import { AgentUsersService } from './agent-users.service';

@Module({
  imports: [AdminAuthModule, IpCommerceModule],
  controllers: [AgentUsersAdminController, AgentUsersInternalController],
  providers: [AgentUsersService, AgentUserRunnerService, ServiceTokenGuard],
  exports: [AgentUsersService, AgentUserRunnerService],
})
export class AgentUsersModule {}
