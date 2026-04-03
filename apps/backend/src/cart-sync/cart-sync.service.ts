import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@orderease/shared-database';
import { mapRedisCartToDb, DbCart, DbCartItem, getCartVersion, safeRemoveDirtyFlag } from '@orderease/shared-contracts';
import { RedisService } from '../infrastructure/redis/redis.service';

@Injectable()
export class CartSyncService {
  private readonly logger = new Logger(CartSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Sync all dirty carts from Redis to PostgreSQL
   */
  async syncDirtyCarts(): Promise<{ synced: number; failed: number }> {
    const dirtyUsers = await this.redisService.smembers('cart:dirty_users');
    
    if (dirtyUsers.length === 0) {
      this.logger.debug('No dirty carts to sync');
      return { synced: 0, failed: 0 };
    }

    this.logger.log(`Found ${dirtyUsers.length} dirty carts to sync`);
    
    let synced = 0;
    let failed = 0;

    for (const userId of dirtyUsers) {
      try {
        const success = await this.syncCartForUser(userId);
        if (success) {
          synced++;
          await this.redisService.srem('cart:dirty_users', userId);
        } else {
          failed++;
        }
      } catch (error) {
        this.logger.error(`Failed to sync cart for user ${userId}`, error);
        failed++;
      }
    }

    this.logger.log(`Cart sync completed: ${synced} synced, ${failed} failed`);
    return { synced, failed };
  }

  /**
   * Sync a single user's cart from Redis to PostgreSQL
   * Race-condition safe using version checking
   */
  private async syncCartForUser(userId: string): Promise<boolean> {
    try {
      const redisKey = `cart:${userId}`; // Inline key generation
      const redisCart = await this.redisService.get(redisKey);

      if (!redisCart) {
        this.logger.warn(`No cart found in Redis for user ${userId}`);
        return true; // Nothing to sync, remove from dirty set
      }

      // Check if cart is empty
      if (!redisCart.items || redisCart.items.length === 0) {
        await this.clearCartInDb(userId);
        return true;
      }

      // Step 1: Get cart version BEFORE sync
      const beforeVersion = await getCartVersion(userId, this.redisService);

      if (beforeVersion === null) {
        this.logger.warn(`Failed to get cart version for user ${userId}, skipping sync`);
        return false;
      }

      // Step 2: Transform Redis cart to DB format
      const dbCartData = mapRedisCartToDb(redisCart, userId);

      // Step 3: Sync to database with transaction
      await this.prisma.$transaction(async (tx) => {
        // Upsert cart
        await tx.cart.upsert({
          where: { userId },
          update: {
            updatedAt: new Date(),
          },
          create: {
            id: dbCartData.cart.id,
            userId,
            createdAt: dbCartData.cart.createdAt,
            updatedAt: dbCartData.cart.updatedAt,
          },
        });

        // Delete existing cart items
        await tx.cartItem.deleteMany({
          where: { cart: { userId } },
        });

        // Insert new cart items
        if (dbCartData.items.length > 0) {
          await tx.cartItem.createMany({
            data: dbCartData.items,
          });
        }
      });

      // Step 4: Safe dirty flag removal
      const result = await safeRemoveDirtyFlag(userId, beforeVersion, this.redisService);
      
      if (result.removed) {
        this.logger.debug(`Successfully synced cart for user ${userId}, dirty flag removed: ${result.reason}`);
      } else {
        this.logger.warn(`Cart sync completed for user ${userId}, but dirty flag NOT removed: ${result.reason}`);
      }

      this.logger.debug(`Successfully synced cart for user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to sync cart for user ${userId}`, error);
      return false;
    }
  }

  /**
   * Clear cart in database (remove all items)
   */
  private async clearCartInDb(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Ensure cart exists
      await tx.cart.upsert({
        where: { userId },
        update: { updatedAt: new Date() },
        create: {
          userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Delete all cart items
      await tx.cartItem.deleteMany({
        where: { cart: { userId } },
      });
    });
  }
}
