import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { FoodModule } from '../food/food.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { KafkaModule } from '../../infrastructure/kafka/kafka.module';

@Module({
  imports: [FoodModule, RedisModule, KafkaModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
