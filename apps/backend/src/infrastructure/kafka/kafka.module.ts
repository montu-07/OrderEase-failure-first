import { Module } from '@nestjs/common';
import { KafkaProducerService } from './kafka.producer';
import { KafkaConsumerService } from './kafka.consumer';
import { KafkaAdminService } from './kafka.admin.service';

@Module({
  providers: [KafkaProducerService, KafkaConsumerService, KafkaAdminService],
  exports: [KafkaProducerService, KafkaConsumerService],
})
export class KafkaModule {}
