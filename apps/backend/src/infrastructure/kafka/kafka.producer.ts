import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, ProducerRecord } from 'kafkajs';
import { KAFKA_TOPICS } from './topics';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private kafka: Kafka;
  private producer: Producer;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeProducer();
  }

  private async initializeProducer() {
    try {
      const kafkaConfig = this.configService.get('kafka');
      
      this.kafka = new Kafka({
        clientId: kafkaConfig.clientId,
        brokers: kafkaConfig.brokers,
        ssl: kafkaConfig.ssl,
        sasl: kafkaConfig.sasl,
      });

      this.producer = this.kafka.producer({
        allowAutoTopicCreation: true,
        maxInFlightRequests: 1,
        idempotent: true,
        transactionTimeout: 30000,
      });

      await this.producer.connect();
      this.logger.log('Kafka producer connected successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Kafka producer', error);
      throw error;
    }
  }

  /**
   * Emit event to Kafka topic
   */
  async emit(topic: string, event: any): Promise<void> {
    if (!this.producer) {
      throw new Error('Kafka producer not initialized');
    }

    try {
      const record: ProducerRecord = {
        topic,
        messages: [
          {
            key: event.userId || 'anonymous',
            value: JSON.stringify(event),
            headers: {
              eventId: event.eventId,
              eventType: event.type,
              timestamp: event.timestamp.toString(),
            },
          },
        ],
      };

      await this.producer.send(record);
      
      this.logger.debug(`Event emitted to topic ${topic}:`, {
        eventId: event.eventId,
        type: event.type,
        userId: event.userId,
      });
    } catch (error) {
      this.logger.error(`Failed to emit event to topic ${topic}`, error);
      throw error;
    }
  }

  /**
   * Emit cart event
   */
  async emitCartEvent(event: any): Promise<void> {
    await this.emit(KAFKA_TOPICS.CART_EVENTS, event);
  }

  async onModuleDestroy() {
    if (this.producer) {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected');
    }
  }
}
