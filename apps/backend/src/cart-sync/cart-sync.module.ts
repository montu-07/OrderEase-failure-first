import { Module } from '@nestjs/common';
import { CartModule } from '../modules/cart/cart.module';
import { DatabaseModule } from '@orderease/shared-database';
import { RedisModule } from '../infrastructure/redis/redis.module';
import { CartSyncService } from './cart-sync.service';

@Module({
  imports: [DatabaseModule, CartModule, RedisModule],
  providers: [CartSyncService],
  exports: [CartSyncService],
})
export class CartSyncModule {}
