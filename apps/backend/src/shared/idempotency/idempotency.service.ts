import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../infrastructure/redis/redis.service';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly processedEventsKey = 'processed_events';
  private readonly eventTTL = 24 * 60 * 60; // 24 hours

  constructor(private readonly redisService: RedisService) {}

  /**
   * Check if event has been processed
   */
  async isEventProcessed(eventId: string): Promise<boolean> {
    try {
      const key = `${this.processedEventsKey}:${eventId}`;
      const result = await this.redisService.get(key);
      return result !== null;
    } catch (error) {
      this.logger.error(`Failed to check if event ${eventId} is processed`, error);
      // Fail safe - assume not processed to allow retry
      return false;
    }
  }

  /**
   * Mark event as processed
   */
  async markEventProcessed(eventId: string): Promise<void> {
    try {
      const key = `${this.processedEventsKey}:${eventId}`;
      await this.redisService.set(key, {
        eventId,
        processedAt: Date.now(),
      }, this.eventTTL);
      
      this.logger.debug(`Event ${eventId} marked as processed`);
    } catch (error) {
      this.logger.error(`Failed to mark event ${eventId} as processed`, error);
      throw error;
    }
  }

  /**
   * Process event with idempotency check
   */
  async processEvent(
    eventId: string,
    handler: () => Promise<void>
  ): Promise<{ processed: boolean; success: boolean }> {
    try {
      // Check if already processed
      if (await this.isEventProcessed(eventId)) {
        this.logger.debug(`Event ${eventId} already processed, skipping`);
        return { processed: false, success: true };
      }

      // Process the event
      await handler();

      // Mark as processed
      await this.markEventProcessed(eventId);

      this.logger.debug(`Event ${eventId} processed successfully`);
      return { processed: true, success: true };
    } catch (error) {
      this.logger.error(`Failed to process event ${eventId}`, error);
      // Don't mark as processed on failure to allow retry
      return { processed: false, success: false };
    }
  }

  /**
   * Clean up old processed events (for maintenance)
   */
  async cleanupOldEvents(): Promise<void> {
    try {
      // This would be called by a maintenance job
      // For now, Redis TTL handles cleanup automatically
      this.logger.debug('Processed events cleanup handled by Redis TTL');
    } catch (error) {
      this.logger.error('Failed to cleanup old events', error);
    }
  }
}
