import { Module } from '@nestjs/common';
import { CartWorker } from '../workers/cart.worker';
import { KafkaModule } from '../infrastructure/kafka/kafka.module';
import { RedisModule } from '../infrastructure/redis/redis.module';
import { DatabaseModule } from '@orderease/shared-database';
import { IdempotencyService } from '../shared/idempotency/idempotency.service';

@Module({
  imports: [KafkaModule, RedisModule, DatabaseModule],
  providers: [CartWorker, IdempotencyService],
})
export class WorkerModule {}
