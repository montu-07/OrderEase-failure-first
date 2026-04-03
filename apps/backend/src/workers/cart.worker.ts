import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KafkaConsumerService } from '../infrastructure/kafka/kafka.consumer';
import { PrismaService } from '@orderease/shared-database';
import { CartEvent, CartEventType } from '../shared/events/cart.events';
import { IdempotencyService } from '../shared/idempotency/idempotency.service';
import { mapRedisCartToDb } from '@orderease/shared-contracts';
import { RedisService } from '../infrastructure/redis/redis.service';

@Injectable()
export class CartWorker implements OnModuleInit {
  private readonly logger = new Logger(CartWorker.name);

  constructor(
    private readonly kafkaConsumer: KafkaConsumerService,
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    await this.startConsuming();
  }

  private async startConsuming() {
    this.logger.log('Starting cart worker...');
    
    await this.kafkaConsumer.subscribeToCartEvents(
      async (event: CartEvent) => {
        await this.handleCartEvent(event);
      }
    );

    this.logger.log('Cart worker started successfully');
  }

  /**
   * Handle cart events with idempotency
   */
  private async handleCartEvent(event: CartEvent): Promise<void> {
    this.logger.debug(`Processing cart event: ${event.type}`, {
      eventId: event.eventId,
      userId: event.userId,
    });

    const result = await this.idempotencyService.processEvent(
      event.eventId,
      () => this.processCartEvent(event)
    );

    if (result.processed) {
      this.logger.debug(`Cart event ${event.eventId} processed successfully`);
    } else if (!result.success) {
      this.logger.error(`Failed to process cart event ${event.eventId}`);
      throw new Error(`Failed to process cart event ${event.eventId}`);
    }
  }

  /**
   * Process individual cart event
   */
  private async processCartEvent(event: CartEvent): Promise<void> {
    switch (event.type) {
      case CartEventType.CART_UPDATED:
      case CartEventType.ITEM_ADDED:
      case CartEventType.ITEM_UPDATED:
      case CartEventType.ITEM_REMOVED:
        await this.syncCartToDatabase(event);
        break;
      
      case CartEventType.CART_CLEARED:
        await this.clearCartInDatabase(event);
        break;
      
      default:
        this.logger.warn(`Unknown cart event type: ${event.type}`);
    }
  }

  /**
   * Sync cart to database
   */
  private async syncCartToDatabase(event: CartEvent): Promise<void> {
    try {
      // Get current cart from Redis to get cartId and complete cart state
      const redisKey = `cart:${event.userId}`;
      const currentCart = await this.redisService.get(redisKey);
      
      if (!currentCart) {
        this.logger.warn(`No cart found in Redis for user ${event.userId}`);
        return;
      }

      // Use the current cart from Redis (which has cartId and full state)
      const redisCart = currentCart;

      // Transform to DB format
      const dbCartData = mapRedisCartToDb(redisCart, event.userId);

      // Sync to database with transaction
      await this.prisma.$transaction(async (tx) => {
        // Upsert cart
        const createdCart = await tx.cart.upsert({
          where: { userId: event.userId },
          update: {
            updatedAt: new Date(),
          },
          create: {
            id: dbCartData.cart.id,
            userId: event.userId,
            createdAt: dbCartData.cart.createdAt,
            updatedAt: dbCartData.cart.updatedAt,
          },
        });

        // Delete existing cart items
        await tx.cartItem.deleteMany({
          where: { cart: { userId: event.userId } },
        });

        // Insert new cart items
        if (dbCartData.items.length > 0) {
          // Use the actual created cart ID, not the Redis cart ID
          const cartItemsWithCorrectId = dbCartData.items.map(item => ({
            ...item,
            cartId: createdCart.id, // ✅ Use the actual database cart ID
          }));
          
          await tx.cartItem.createMany({
            data: cartItemsWithCorrectId,
          });
        }
      });
    } catch (error) {
      this.logger.error(`Failed to sync cart to database for user ${event.userId}`, error);
      throw error;
    }
  }

  /**
   * Clear cart in database
   */
  private async clearCartInDatabase(event: CartEvent): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Delete all cart items for user
        await tx.cartItem.deleteMany({
          where: { cart: { userId: event.userId } },
        });

        // Update cart timestamp
        await tx.cart.updateMany({
          where: { userId: event.userId },
          data: {
            updatedAt: new Date(),
          },
        });
      });

      this.logger.debug(`Cart cleared in database for user ${event.userId}`);
    } catch (error) {
      this.logger.error(`Failed to clear cart in database for user ${event.userId}`, error);
      throw error;
    }
  }
}
