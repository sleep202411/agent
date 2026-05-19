import { Module } from '@nestjs/common';
import { JavaIntegrationsModule } from '../integrations/java/integrations.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Users module — currently exposes the user-lookup BFF endpoint
 * consumed by the crew add-member dialog. Will grow as more
 * cross-Java user features land (talent-market filters that need
 * server-side composition, etc).
 */
@Module({
  imports: [JavaIntegrationsModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
