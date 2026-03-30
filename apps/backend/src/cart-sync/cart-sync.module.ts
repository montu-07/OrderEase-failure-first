import { Module } from '@nestjs/common';
import { CartSyncService } from './cart-sync.service';
import { CartSyncCron } from './cart-sync.cron';
import { CartModule } from '../cart/cart.module';
import { DatabaseModule } from '@orderease/shared-database';

@Module({
  imports: [DatabaseModule, CartModule],
  providers: [CartSyncService, CartSyncCron],
  exports: [CartSyncService],
})
export class CartSyncModule {}
