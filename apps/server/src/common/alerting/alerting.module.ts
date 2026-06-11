import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AlertingExceptionFilter } from './alerting-exception.filter';
import { AlertingService } from './alerting.service';

@Global()
@Module({
  providers: [
    AlertingService,
    {
      provide: APP_FILTER,
      useClass: AlertingExceptionFilter,
    },
  ],
  exports: [AlertingService],
})
export class AlertingModule {}
