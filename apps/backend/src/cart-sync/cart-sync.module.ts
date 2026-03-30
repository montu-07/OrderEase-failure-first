import { Module } from '@nestjs/common';
import { CartSyncService } from './cart-sync.service';
import { CartSyncCron } from './cart-sync.cron';

@Module({
  providers: [CartSyncService, CartSyncCron],
  exports: [CartSyncService],
})
export class CartSyncModule {}
