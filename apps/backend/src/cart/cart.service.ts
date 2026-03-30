import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AddToCartDto, UpdateCartItemDto } from '@orderease/shared-contracts';
import {
  type ICartRepository,
  CART_REPOSITORY,
} from './infra/cart.repository.interface';
import {
  type IFoodRepository,
  FOOD_REPOSITORY,
} from '../food/infra/food.repository.interface';
import { FoodDomainError } from '@orderease/shared-contracts';
import { CartDomainError } from '@orderease/shared-contracts';
import { centsToDisplay } from '@orderease/shared-utils';
import { RedisService } from './redis.service';
import {
  RedisCart,
  RedisCartItem,
  mapDbCartToRedisCart,
  mapRedisCartToDbCartItems,
  getCartRedisKey,
  addItemInRedisCart,
  updateItemInRedisCart,
  removeItemFromRedisCart,
  clearRedisCart,
} from './cart-transformers';
import {
  addItemToCart,
  updateItemInCart,
  removeItemFromCart,
  clearCartItems,
  redisCartToMutations,
  mutationsToRedisCart,
  mapDbCartToRedis,
  isRedisCartEmpty,
  createEmptyRedisCart,
} from '@orderease/shared-contracts';
import { PrismaService } from '@orderease/shared-database';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    @Inject(CART_REPOSITORY)
    private cartRepository: ICartRepository,
    @Inject(FOOD_REPOSITORY)
    private foodRepository: IFoodRepository,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Mark cart as dirty for async sync with fallback
   */
  private async markCartDirty(userId: string): Promise<void> {
    if (this.redisService.isAvailable()) {
      let retryCount = 0;
      const maxRetries = 2;
      
      while (retryCount < maxRetries) {
        try {
          await this.redisService.set(`cart:dirty:${userId}`, true, 7 * 24 * 60 * 60); // 7 days TTL
          await this.redisService.sadd('cart:dirty_users', userId);
          this.logger.debug(`Cart marked as dirty for user ${userId}`);
          return; // Success - exit retry loop
        } catch (error) {
          retryCount++;
          this.logger.warn(`Dirty flag attempt ${retryCount} failed for user ${userId}`, error);
          
          if (retryCount >= maxRetries) {
            // Final retry failed - fallback to DB sync
            this.logger.error(`Dirty flag failed after ${maxRetries} attempts for user ${userId}, falling back to DB sync`, error);
            await this.fallbackDbSync(userId);
            return;
          }
          
          // Wait before retry (exponential backoff: 100ms, 200ms)
          await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
        }
      }
    }
  }

  /**
   * Fallback DB sync when dirty flag fails
   * Ensures consistency between Redis and DB
   */
  private async fallbackDbSync(userId: string): Promise<void> {
    try {
      const redisKey = getCartRedisKey(userId);
      const redisCart = await this.redisService.get(redisKey);
      
      if (redisCart) {
        // Transform Redis cart to DB format and sync immediately
        const mutations = redisCartToMutations(redisCart);
        
        // Get existing cart to preserve cartId
        const existingCart = await this.cartRepository.findByUserId(userId);
        
        if (existingCart) {
          // Update existing cart with Redis data
          await this.prisma.$transaction(async (tx) => {
            // Delete existing cart items
            await tx.cartItem.deleteMany({
              where: { cart: { userId } },
            });

            // Insert Redis cart items
            if (mutations.length > 0) {
              await tx.cartItem.createMany({
                data: mutations.map(item => ({
                  cartId: existingCart.id!, // Non-null assertion since we checked existingCart exists
                  foodId: item.foodId,
                  quantity: item.quantity,
                  price: item.price || 0,
                })),
              });
            }

            // Update cart timestamp
            await tx.cart.update({
              where: { id: existingCart.id },
              data: { updatedAt: new Date() },
            });
          });

          this.logger.log(`Emergency DB sync completed for user ${userId}, ${mutations.length} items synced`);
        }
      }
    } catch (error) {
      this.logger.error(`Emergency DB sync failed for user ${userId}`, error);
      // Don't throw - system will continue with Redis data
    }
  }

  /**
   * Clear cart from database (fallback when Redis fails)
   * Ensures destructive operations are consistent
   */
  private async clearCartFromDb(userId: string): Promise<void> {
    try {
      const cart = await this.cartRepository.findByUserId(userId);
      
      if (cart) {
        // Use existing repository method for consistency
        await this.cartRepository.clearCart(userId);
        this.logger.log(`Cart cleared from DB for user ${userId} (Redis fallback)`);
      } else {
        // Create empty cart if none exists
        await this.cartRepository.getOrCreate(userId);
        this.logger.log(`Empty cart created in DB for user ${userId} (Redis fallback)`);
      }
    } catch (error) {
      this.logger.error(`Failed to clear cart from DB for user ${userId}`, error);
      throw error; // Re-throw as this is critical operation
    }
  }

  /**
   * Get cart from database (fallback when Redis fails)
   */
  private async getCartFromDb(userId: string) {
    try {
      const cartData = await this.cartRepository.findByUserIdWithDetails(userId);
      
      if (!cartData) {
        // Create empty cart
        const cart = await this.cartRepository.getOrCreate(userId);
        
        return {
          ...cart,
          totalPrice: 0,
          itemCount: 0,
          items: [],
        };
      }

      const { cart, foodDetails } = cartData;

      // Calculate total in cents (integer arithmetic)
      const totalPriceCents = cart.items.reduce((sum, item) => {
        const food = foodDetails.get(item.foodId);
        return sum + (food?.price || 0) * item.quantity;
      }, 0);

      return {
        id: cart.id,
        userId: cart.userId,
        items: cart.items.map((item) => {
          const food = foodDetails.get(item.foodId);
          return {
            foodId: item.foodId,
            quantity: item.quantity,
            food: food ? {
              ...food,
              price: centsToDisplay(food.price), // Convert to display format
            } : undefined,
          };
        }),
        totalPrice: centsToDisplay(totalPriceCents), // Convert to display format
        itemCount: cart.items.length,
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
      };
    } catch (error) {
      this.logger.error(`Failed to get cart from DB for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Get or create user's cart with items
   * Hybrid implementation: Try Redis first, fallback to DB
   */
  async getCart(userId: string) {
    const redisKey = getCartRedisKey(userId);
    
    // Step 1: Try Redis first
    if (this.redisService.isAvailable()) {
      try {
        const redisCart = await this.redisService.get(redisKey);
        
        if (redisCart && !isRedisCartEmpty(redisCart)) {
          this.logger.debug(`Cart cache hit for user ${userId}`);
          
          // Transform Redis cart to expected format
          const totalPriceCents = redisCart.items.reduce((sum, item) => {
            return sum + item.price * item.quantity;
          }, 0);

          return {
            id: redisCart.cartId || 'redis-cart', // Use real cart ID from Redis
            userId,
            items: redisCart.items.map((item) => ({
              foodId: item.foodId,
              quantity: item.quantity,
              food: {
                id: item.foodId,
                name: item.name,
                price: centsToDisplay(item.price),
                description: '',
                imageUrl: '',
                isAvailable: true,
                category: '',
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            })),
            totalPrice: centsToDisplay(totalPriceCents),
            itemCount: redisCart.items.length,
            createdAt: new Date(redisCart.updatedAt),
            updatedAt: new Date(redisCart.updatedAt),
          };
        }
      } catch (error) {
        this.logger.warn(`Redis read failed for user ${userId}, falling back to DB`, error);
      }
    }

    // Step 2: Redis MISS or Redis unavailable - fetch from DB
    this.logger.debug(`Cart cache miss for user ${userId}, fetching from DB`);
    const cartData = await this.cartRepository.findByUserIdWithDetails(userId);

    if (!cartData) {
      // Create empty cart
      const cart = await this.cartRepository.getOrCreate(userId);
      
      // Cache empty cart in Redis
      if (this.redisService.isAvailable()) {
        try {
          const emptyRedisCart: RedisCart = {
            cartId: cart.id || 'empty-cart', // Store real cart ID or placeholder
            items: [],
            updatedAt: new Date().toISOString(),
          };
          await this.redisService.set(redisKey, emptyRedisCart);
        } catch (error) {
          this.logger.warn(`Failed to cache empty cart for user ${userId}`, error);
        }
      }

      return {
        ...cart,
        totalPrice: 0,
        itemCount: 0,
        items: [],
      };
    }

    const { cart, foodDetails } = cartData;

    // Calculate total in cents (integer arithmetic)
    const totalPriceCents = cart.items.reduce((sum, item) => {
      const food = foodDetails.get(item.foodId);
      return sum + (food?.price || 0) * item.quantity;
    }, 0);

    const result = {
      id: cart.id,
      userId: cart.userId,
      items: cart.items.map((item) => {
        const food = foodDetails.get(item.foodId);
        return {
          foodId: item.foodId,
          quantity: item.quantity,
          food: food ? {
            ...food,
            price: centsToDisplay(food.price), // Convert to display format
          } : undefined,
        };
      }),
      totalPrice: centsToDisplay(totalPriceCents), // Convert to display format
      itemCount: cart.items.length,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
    };

    // Step 3: Hydrate Redis with DB data
    if (this.redisService.isAvailable()) {
      try {
        const redisCart = mapDbCartToRedisCart({
          id: cart.id || '',
          userId: cart.userId || '',
          createdAt: cart.createdAt || new Date(),
          updatedAt: cart.updatedAt || new Date(),
          items: cart.items || [],
        });
        if (redisCart) {
          await this.redisService.set(redisKey, redisCart);
          this.logger.debug(`Cached cart for user ${userId} in Redis`);
        }
      } catch (error) {
        this.logger.warn(`Failed to cache cart for user ${userId}`, error);
      }
    }

    return result;
  }

  /**
   * Add item to cart or update quantity if exists
   * Redis primary with DB fallback on failure
   */
  async addToCart(userId: string, addToCartDto: AddToCartDto) {
    const { foodId, quantity } = addToCartDto;
    const redisKey = getCartRedisKey(userId);

    try {
      // Check if food exists and is available
      const food = await this.foodRepository.findById(foodId);

      if (!food) {
        throw FoodDomainError.notFound();
      }

      if (!food.isAvailable) {
        throw FoodDomainError.unavailable();
      }

      // Step 1: Try Redis update (primary path)
      if (this.redisService.isAvailable()) {
        try {
          let redisCart = await this.redisService.get(redisKey);
          const currentMutations = redisCart ? redisCartToMutations(redisCart) : [];
          
          // Add item using helper
          const updatedMutations = addItemToCart(
            currentMutations,
            foodId,
            quantity,
            food.price
          );

          // Convert back to Redis format
          redisCart = mutationsToRedisCart(updatedMutations, redisCart?.cartId);

          // Set cartId if this is the first time creating cart in Redis
          if (!redisCart.cartId) {
            const existingCart = await this.cartRepository.findByUserId(userId);
            redisCart.cartId = existingCart?.id || 'new-cart';
          }

          // Set in Redis with TTL
          await this.redisService.set(redisKey, redisCart);

          // Mark as dirty for async sync
          await this.markCartDirty(userId);

          this.logger.debug(`Redis update successful for user ${userId}, added item ${foodId}`);
          return this.getCart(userId);
        } catch (redisError) {
          this.logger.error(`Redis update failed for user ${userId}, falling back to DB`, redisError);
          // Fall through to DB fallback
        }
      }

      // Step 2: DB fallback (Redis unavailable or failed)
      this.logger.warn(`Using DB fallback for user ${userId}, operation: add item ${foodId}`);
      
      // Use existing DB logic
      await this.cartRepository.addOrUpdateItem(userId, foodId, quantity);
      
      return this.getCart(userId);
    } catch (error) {
      if (error instanceof FoodDomainError) {
        if (error.code === 'FOOD_NOT_FOUND') {
          throw new NotFoundException('Food item not found');
        }
        if (error.code === 'FOOD_UNAVAILABLE') {
          throw new BadRequestException('Food item is not available');
        }
      }
    }
  }

  /**
   * Update cart item quantity
   * Redis primary with DB fallback on failure
   */
  async updateCartItem(
    userId: string,
    itemId: string,
    updateCartItemDto: UpdateCartItemDto,
  ) {
    const { quantity } = updateCartItemDto;
    const redisKey = getCartRedisKey(userId);

    try {
      // Get cart for verification
      const cart = await this.cartRepository.findByUserId(userId);

      if (!cart) {
        throw CartDomainError.notFound();
      }

      // Verify cart item exists and belongs to user's cart
      const cartItem = await this.cartRepository.getCartItem(itemId);

      if (!cartItem) {
        throw CartDomainError.itemNotFound();
      }

      // Verify ownership
      const ownsItem = await this.cartRepository.verifyItemOwnership(
        userId,
        itemId,
      );
      if (!ownsItem) {
        throw CartDomainError.itemNotFound();
      }

      // Step 1: Try Redis update (primary path)
      if (this.redisService.isAvailable()) {
        try {
          let redisCart = await this.redisService.get(redisKey);
          const currentMutations = redisCart ? redisCartToMutations(redisCart) : [];
          
          // Update item using helper
          const updatedMutations = updateItemInCart(
            currentMutations,
            cartItem.foodId,
            quantity
          );

          // Convert back to Redis format
          redisCart = mutationsToRedisCart(updatedMutations, redisCart?.cartId);

          // Ensure cartId is preserved
          if (!redisCart.cartId) {
            const existingCart = await this.cartRepository.findByUserId(userId);
            redisCart.cartId = existingCart?.id || 'updated-cart';
          }

          // Set in Redis with TTL
          await this.redisService.set(redisKey, redisCart);

          // Mark as dirty for async sync
          await this.markCartDirty(userId);

          this.logger.debug(`Redis update successful for user ${userId}, updated item ${cartItem.foodId}`);
          return this.getCart(userId);
        } catch (redisError) {
          this.logger.error(`Redis update failed for user ${userId}, falling back to DB`, redisError);
          // Fall through to DB fallback
        }
      }

      // Step 2: DB fallback (Redis unavailable or failed)
      this.logger.warn(`Using DB fallback for user ${userId}, operation: update item ${cartItem.foodId}`);
      
      // Use existing DB logic
      await this.cartRepository.updateItemQuantity(userId, itemId, quantity);
      
      return this.getCart(userId);
    } catch (error) {
      if (error instanceof CartDomainError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  /**
   * Remove item from cart
   * Redis primary with DB fallback on failure
   */
  async removeFromCart(userId: string, itemId: string) {
    const redisKey = getCartRedisKey(userId);

    try {
      // Get cart for verification
      const cart = await this.cartRepository.findByUserId(userId);

      if (!cart) {
        throw CartDomainError.notFound();
      }

      // Verify cart item exists and belongs to user's cart
      const cartItem = await this.cartRepository.getCartItem(itemId);

      if (!cartItem) {
        throw CartDomainError.itemNotFound();
      }

      // Verify ownership
      const ownsItem = await this.cartRepository.verifyItemOwnership(
        userId,
        itemId,
      );
      if (!ownsItem) {
        throw CartDomainError.itemNotFound();
      }

      // Step 1: Try Redis update (primary path)
      if (this.redisService.isAvailable()) {
        try {
          let redisCart = await this.redisService.get(redisKey);
          const currentMutations = redisCart ? redisCartToMutations(redisCart) : [];
          
          // Remove item using helper
          const updatedMutations = removeItemFromCart(
            currentMutations,
            cartItem.foodId
          );

          // Convert back to Redis format
          redisCart = mutationsToRedisCart(updatedMutations, redisCart?.cartId);

          // Ensure cartId is preserved
          if (!redisCart.cartId) {
            const existingCart = await this.cartRepository.findByUserId(userId);
            redisCart.cartId = existingCart?.id || 'removed-cart';
          }

          // Set in Redis with TTL
          await this.redisService.set(redisKey, redisCart);

          // Mark as dirty for async sync
          await this.markCartDirty(userId);

          this.logger.debug(`Redis update successful for user ${userId}, removed item ${cartItem.foodId}`);
          return this.getCart(userId);
        } catch (redisError) {
          this.logger.error(`Redis update failed for user ${userId}, falling back to DB`, redisError);
          // Fall through to DB fallback
        }
      }

      // Step 2: DB fallback (Redis unavailable or failed)
      this.logger.warn(`Using DB fallback for user ${userId}, operation: remove item ${cartItem.foodId}`);
      
      // Use existing DB logic
      await this.cartRepository.removeItem(userId, itemId);
      
      return this.getCart(userId);
    } catch (error) {
      if (error instanceof CartDomainError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  /**
   * Clear all items from cart
   * Redis primary with DB fallback on failure
   */
  async clearCart(userId: string) {
    const redisKey = getCartRedisKey(userId);

    // Case 1: Redis unavailable - immediate DB fallback
    if (!this.redisService.isAvailable()) {
      this.logger.warn(`Redis unavailable for user ${userId}, clearing cart from DB directly`);
      await this.clearCartFromDb(userId);
      return this.getCartFromDb(userId);
    }

    try {
      // Case 2: Try Redis first (primary path)
      let redisCart = await this.redisService.get(redisKey);
      
      // Create empty cart in Redis format
      const emptyRedisCart = mutationsToRedisCart(
        clearCartItems(),
        redisCart?.cartId
      );

      // Set empty cart in Redis
      await this.redisService.set(redisKey, emptyRedisCart);
      
      // Mark as dirty for async sync (with retry logic)
      await this.markCartDirty(userId);

      this.logger.debug(`Redis cart cleared successfully for user ${userId}`);
      return this.getCart(userId);
      
    } catch (redisError) {
      // Case 3: Redis operation failed - fallback to DB
      this.logger.error(`Redis clear failed for user ${userId}, falling back to DB`, redisError);
      
      await this.clearCartFromDb(userId);
      return this.getCartFromDb(userId);
    }
  }
}
