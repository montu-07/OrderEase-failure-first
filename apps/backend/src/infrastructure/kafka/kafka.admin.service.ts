import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Admin } from 'kafkajs';
import { KAFKA_TOPICS } from './topics';

@Injectable()
export class KafkaAdminService implements OnModuleInit {
  private readonly logger = new Logger(KafkaAdminService.name);
  private kafka: Kafka;
  private admin: Admin;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeAdmin();
  }

  private async initializeAdmin() {
    try {
      const kafkaConfig = this.configService.get('kafka');
      
      this.kafka = new Kafka({
        clientId: `${kafkaConfig.clientId}-admin`,
        brokers: kafkaConfig.brokers,
        ssl: kafkaConfig.ssl,
        sasl: kafkaConfig.sasl,
      });

      this.admin = this.kafka.admin();
      await this.admin.connect();
      this.logger.log('Kafka admin connected successfully');

      // Create topics if they don't exist
      await this.createTopics();
    } catch (error) {
      this.logger.error('Failed to initialize Kafka admin', error);
      throw error;
    }
  }

  private async createTopics() {
    try {
      const topics = Object.values(KAFKA_TOPICS).map(topic => ({
        topic,
        numPartitions: 1,
        replicationFactor: 1,
      }));

      await this.admin.createTopics({
        topics,
        validateOnly: false,
        waitForLeaders: true,
      });

      this.logger.log('Kafka topics created/verified successfully');
    } catch (error) {
      // Topics might already exist, log but don't fail
      if (error.name === 'TopicExistsError' || error.type === 'TOPIC_ALREADY_EXISTS') {
        this.logger.log('Kafka topics already exist');
      } else {
        this.logger.error('Failed to create Kafka topics', error);
        throw error;
      }
    }
  }

  async onModuleDestroy() {
    try {
      if (this.admin) {
        await this.admin.disconnect();
        this.logger.log('Kafka admin disconnected');
      }
    } catch (error) {
      this.logger.error('Error disconnecting Kafka admin', error);
    }
  }
}
