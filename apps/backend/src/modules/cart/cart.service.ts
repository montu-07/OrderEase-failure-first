import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { AddToCartDto, UpdateCartItemDto } from '@orderease/shared-contracts';
import { CartDomainError } from '@orderease/shared-contracts';
import { centsToDisplay } from '@orderease/shared-utils';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { KafkaProducerService } from '../../infrastructure/kafka/kafka.producer';
import { FoodService } from '../food/food.service';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly kafkaProducerService: KafkaProducerService,
    private readonly foodService: FoodService,
  ) {}

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Get user's cart from Redis
   */
  async getCart(userId: string) {
    const redisKey = `cart:${userId}`;
    
    try {
      const cartData = await this.redisService.get(redisKey);
      
      if (!cartData) {
        // Return empty cart
        return {
          id: 'empty-cart',
          userId,
          items: [],
          totalPrice: '0.00',
          itemCount: 0,
        };
      }

      // Parse Redis cart data
      const cart = typeof cartData === 'string' ? JSON.parse(cartData) : cartData;
      
      if (!cart || !cart.items || cart.items.length === 0) {
        return {
          id: cart.cartId || 'redis-cart',
          userId,
          items: [],
          totalPrice: '0.00',
          itemCount: 0,
        };
      }

      // Calculate total price by fetching food prices dynamically (integer arithmetic for 100% accuracy)
      const totalPriceCents = await Promise.all(
        cart.items.map(async (item) => {
          try {
            const food = await this.foodService.findOne(item.foodId);
            // Ensure integer arithmetic - food.price is already in cents, quantity is integer
            const itemTotalCents = Math.round(food.price * item.quantity);
            return itemTotalCents;
          } catch (error) {
            this.logger.warn(`Failed to fetch price for food ${item.foodId}`, error);
            return 0; // Default to 0 if food not found
          }
        })
      ).then(prices => prices.reduce((sum, price) => sum + price, 0));

      // Enrich cart items with food details
      const enrichedItems = await Promise.all(
        cart.items.map(async (item) => {
          try {
            const food = await this.foodService.findOne(item.foodId);
            // Ensure integer arithmetic for subtotal calculation
            const itemTotalCents = Math.round(food.price * item.quantity);
            return {
              ...item,
              price: food.price, // Include price for display (in cents)
              subtotal: centsToDisplay(itemTotalCents), // Use rounded integer
            };
          } catch (error) {
            this.logger.warn(`Failed to fetch details for food ${item.foodId}`, error);
            return {
              ...item,
              price: 0,
              subtotal: '0.00',
            };
          }
        })
      );

      return {
        id: cart.cartId || 'redis-cart',
        userId,
        items: enrichedItems,
        totalPrice: centsToDisplay(totalPriceCents),
        itemCount: cart.items.length,
      };
    } catch (error) {
      this.logger.error(`Failed to get cart for user ${userId}`, error);
      throw new CartDomainError('Failed to retrieve cart', 'CART_RETRIEVAL_FAILED');
    }
  }

  /**
   * Add item to cart
   */
  async addToCart(userId: string, addToCartDto: AddToCartDto) {
    try {
      const redisKey = `cart:${userId}`;
      
      // Get current cart
      const currentCart = await this.redisService.get(redisKey);
      const cart = currentCart || { 
        cartId: `cart_${userId}_${Date.now()}`,
        items: [],
        updatedAt: Date.now()
      };
      
      // Check if item already exists
      const existingItemIndex = cart.items.findIndex(item => item.foodId === addToCartDto.foodId);
      
      if (existingItemIndex >= 0) {
        // Update existing item
        cart.items[existingItemIndex].quantity += addToCartDto.quantity;
      } else {
        // Add new item
        cart.items.push({
          foodId: addToCartDto.foodId,
          quantity: addToCartDto.quantity,
        });
      }

      // Update timestamp
      cart.updatedAt = Date.now();

      // Save updated cart
      await this.redisService.set(redisKey, cart, 7 * 24 * 60 * 60); // 7 days TTL
      
      // Emit Kafka event
      const event = {
        eventId: this.generateEventId(),
        type: 'ITEM_ADDED',
        userId,
        payload: {
          items: [{
            foodId: addToCartDto.foodId,
            quantity: addToCartDto.quantity,
          }],
        },
        timestamp: Date.now(),
      };
      
      await this.kafkaProducerService.emit('cart-events', event);
      
      this.logger.log(`Item added to cart for user ${userId}: ${addToCartDto.foodId} x ${addToCartDto.quantity}`);
      
      return { success: true, message: 'Item added to cart' };
    } catch (error) {
      this.logger.error(`Failed to add item to cart for user ${userId}`, error);
      throw new CartDomainError('Failed to add item to cart', 'CART_ADD_FAILED');
    }
  }

  /**
   * Update cart item
   */
  async updateCartItem(userId: string, foodId: string, updateDto: UpdateCartItemDto) {
    try {
      const redisKey = `cart:${userId}`;
      
      // Get current cart
      const currentCart = await this.redisService.get(redisKey);
      const cart = currentCart || { 
        cartId: `cart_${userId}_${Date.now()}`,
        items: [],
        updatedAt: Date.now()
      };
      
      // Find item to update
      const itemIndex = cart.items.findIndex(item => item.foodId === foodId);
      
      if (itemIndex < 0) {
        throw new NotFoundException('Item not found in cart');
      }
      
      // Update item
      cart.items[itemIndex].quantity = updateDto.quantity;
      
      // Remove item if quantity is 0
      if (cart.items[itemIndex].quantity <= 0) {
        cart.items.splice(itemIndex, 1);
      }

      // Update timestamp
      cart.updatedAt = Date.now();

      // Save updated cart
      await this.redisService.set(redisKey, cart, 7 * 24 * 60 * 60); // 7 days TTL
      
      // Emit Kafka event
      const event = {
        eventId: this.generateEventId(),
        type: 'ITEM_UPDATED',
        userId,
        payload: {
          items: [{
            foodId: foodId,
            quantity: cart.items[itemIndex]?.quantity || 0,
          }],
        },
        timestamp: Date.now(),
      };
      
      await this.kafkaProducerService.emit('cart-events', event);
      
      this.logger.log(`Cart item updated for user ${userId}: ${foodId} -> ${updateDto.quantity}`);
      
      return { success: true, message: 'Cart item updated' };
    } catch (error) {
      this.logger.error(`Failed to update cart item for user ${userId}`, error);
      throw new CartDomainError('Failed to update cart item', 'CART_UPDATE_FAILED');
    }
  }

  /**
   * Remove item from cart
   */
  async removeFromCart(userId: string, foodId: string) {
    try {
      const redisKey = `cart:${userId}`;
      
      // Get current cart
      const currentCart = await this.redisService.get(redisKey);
      const cart = currentCart || { 
        cartId: `cart_${userId}_${Date.now()}`,
        items: [],
        updatedAt: Date.now()
      };
      
      // Find and remove item
      const itemIndex = cart.items.findIndex(item => item.foodId === foodId);
      
      if (itemIndex < 0) {
        throw new NotFoundException('Item not found in cart');
      }
      
      cart.items.splice(itemIndex, 1);
      
      // Update timestamp
      cart.updatedAt = Date.now();

      // Save updated cart
      await this.redisService.set(redisKey, cart, 7 * 24 * 60 * 60); // 7 days TTL
      
      // Emit Kafka event
      const event = {
        eventId: this.generateEventId(),
        type: 'ITEM_REMOVED',
        userId,
        payload: {
          items: [{
            foodId: foodId,
            quantity: 0,
          }],
        },
        timestamp: Date.now(),
      };
      
      await this.kafkaProducerService.emit('cart-events', event);
      
      this.logger.log(`Item removed from cart for user ${userId}: ${foodId}`);
      
      return { success: true, message: 'Item removed from cart' };
    } catch (error) {
      this.logger.error(`Failed to remove item from cart for user ${userId}`, error);
      throw new CartDomainError('Failed to remove item from cart', 'CART_REMOVE_FAILED');
    }
  }

  /**
   * Clear cart
   */
  async clearCart(userId: string) {
    try {
      const redisKey = `cart:${userId}`;
      
      // Clear cart in Redis
      await this.redisService.set(redisKey, { 
        cartId: `cart_${userId}_${Date.now()}`,
        items: [],
        updatedAt: Date.now()
      }, 7 * 24 * 60 * 60); // 7 days TTL
      
      // Emit Kafka event
      const event = {
        eventId: this.generateEventId(),
        type: 'CART_CLEARED',
        userId,
        payload: {
          items: [],
        },
        timestamp: Date.now(),
      };
      
      await this.kafkaProducerService.emit('cart-events', event);
      
      this.logger.log(`Cart cleared for user ${userId}`);
      
      return { success: true, message: 'Cart cleared' };
    } catch (error) {
      this.logger.error(`Failed to clear cart for user ${userId}`, error);
      throw new CartDomainError('Failed to clear cart', 'CART_CLEAR_FAILED');
    }
  }
}
