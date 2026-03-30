import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { RedisHealthController } from './redis-health.controller';
import { CartService } from './cart.service';
import { RedisService } from './redis.service';
import { DatabaseModule } from '@orderease/shared-database';
import { PrismaCartRepository } from './infra/prisma-cart.repository';
import { CART_REPOSITORY } from './infra/cart.repository.interface';
import { FoodModule } from '../food/food.module';

@Module({
  imports: [DatabaseModule, FoodModule],
  controllers: [CartController, RedisHealthController],
  providers: [
    CartService,
    RedisService,
    {
      provide: CART_REPOSITORY,
      useClass: PrismaCartRepository,
    },
  ],
  exports: [CartService, RedisService, CART_REPOSITORY],
})
export class CartModule {}
