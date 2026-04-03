import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, ConsumerSubscribeTopic, ConsumerRunConfig } from 'kafkajs';
import { KAFKA_TOPICS } from './topics';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private kafka: Kafka;
  private consumer: Consumer;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeConsumer();
  }

  private async initializeConsumer() {
    try {
      const kafkaConfig = this.configService.get('kafka');
      
      this.kafka = new Kafka({
        clientId: `${kafkaConfig.clientId}-consumer`,
        brokers: kafkaConfig.brokers,
        ssl: kafkaConfig.ssl,
        sasl: kafkaConfig.sasl,
      });

      this.consumer = this.kafka.consumer({
        groupId: kafkaConfig.consumerGroupId,
        allowAutoTopicCreation: true,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
        maxWaitTimeInMs: 5000,
      });

      await this.consumer.connect();
      this.logger.log('Kafka consumer connected successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Kafka consumer', error);
      throw error;
    }
  }

  /**
   * Subscribe to topic and start consuming
   */
  async subscribe(
    topic: string,
    handler: (message: any) => Promise<void>
  ): Promise<void> {
    if (!this.consumer) {
      throw new Error('Kafka consumer not initialized');
    }

    try {
      const subscribeTopic: ConsumerSubscribeTopic = {
        topic,
        fromBeginning: false,
      };

      await this.consumer.subscribe(subscribeTopic);
      this.logger.log(`Successfully subscribed to topic: ${topic}`);

      const runConfig: ConsumerRunConfig = {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        eachMessage: async ({ topic, partition, message }) => {
          try {
            if (!message.value) {
              this.logger.warn('Received empty message');
              return;
            }

            const event = JSON.parse(message.value.toString());
            
            this.logger.debug(`Processing message from topic ${topic}:`, {
              eventId: message.headers?.eventId?.toString(),
              eventType: message.headers?.eventType?.toString(),
            });

            await handler(event);
          } catch (error) {
            this.logger.error(`Error processing message from topic ${topic}`, error);
            // Don't throw here to avoid stopping the consumer
          }
        },
      };

      await this.consumer.run(runConfig);
      this.logger.log(`Started consuming messages from topic: ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to topic ${topic}`, error);
      throw error;
    }
  }

  /**
   * Subscribe to cart events
   */
  async subscribeToCartEvents(handler: (event: any) => Promise<void>): Promise<void> {
    await this.subscribe(KAFKA_TOPICS.CART_EVENTS, handler);
  }

  async onModuleDestroy() {
    try {
      if (this.consumer) {
        await this.consumer.disconnect();
        this.logger.log('Kafka consumer disconnected');
      }
    } catch (error) {
      this.logger.error('Error disconnecting Kafka consumer', error);
    }
  }
}
