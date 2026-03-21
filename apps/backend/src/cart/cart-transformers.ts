/**
 * Cart Transformation Helpers
 * Converts between DB schema and Redis schema
 * Avoids duplicating transformation logic
 */

import { Cart, CartItem, Food } from '@prisma/client';

/**
 * Redis Cart Item format
 */
export interface RedisCartItem {
  foodId: string;
  name: string;
  price: number;
  quantity: number;
}

/**
 * Redis Cart format
 */
export interface RedisCart {
  cartId: string; // Add real cart ID
  items: RedisCartItem[];
  updatedAt: string;
}

/**
 * Transform DB cart to Redis format
 * @param dbCart - Database cart with items and food details
 * @returns Redis cart format
 */
export function mapDbCartToRedisCart(
  dbCart: {
    id: string;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
    items: any[]; // CartItemWithFood type
  } | null,
): RedisCart | null {
  if (!dbCart || !dbCart.items) {
    return null;
  }

  return {
    cartId: dbCart.id, // Store real cart ID
    items: dbCart.items.map(item => ({
      foodId: item.foodId,
      name: item.food?.name || 'Unknown',
      price: item.food?.price || 0,
      quantity: item.quantity,
    })),
    updatedAt: dbCart.updatedAt.toISOString(),
  };
}

/**
 * Transform Redis cart to DB cart items format
 * @param redisCart - Redis cart format
 * @returns Array of cart items in DB format
 */
export function mapRedisCartToDbCartItems(redisCart: RedisCart | null): {
  foodId: string;
  quantity: number;
}[] {
  if (!redisCart || !redisCart.items) {
    return [];
  }

  return redisCart.items.map(item => ({
    foodId: item.foodId,
    quantity: item.quantity,
  }));
}

/**
 * Generate Redis cart key for user
 * @param userId - User ID
 * @returns Redis key string
 */
export function getCartRedisKey(userId: string): string {
  return `cart:${userId}`;
}

/**
 * Check if Redis cart is empty
 * @param redisCart - Redis cart format
 * @returns True if cart is empty or null
 */
export function isRedisCartEmpty(redisCart: RedisCart | null): boolean {
  return !redisCart || !redisCart.items || redisCart.items.length === 0;
}

/**
 * Update item quantity in Redis cart
 * @param redisCart - Redis cart
 * @param foodId - Food ID
 * @param quantity - New quantity
 * @returns Updated Redis cart
 */
export function updateItemInRedisCart(
  redisCart: RedisCart | null,
  foodId: string,
  quantity: number,
): RedisCart {
  if (!redisCart) {
    return {
      cartId: '', // Will be set by caller
      items: [],
      updatedAt: new Date().toISOString(),
    };
  }

  const existingItemIndex = redisCart.items.findIndex(item => item.foodId === foodId);
  
  if (quantity <= 0) {
    // Remove item if quantity is 0 or less
    redisCart.items = redisCart.items.filter(item => item.foodId !== foodId);
  } else if (existingItemIndex >= 0) {
    // Update existing item
    redisCart.items[existingItemIndex].quantity = quantity;
  } else {
    // Add new item (need food details from DB)
    // This case should be handled by the service layer
    throw new Error('Cannot add new item without food details. Use addItemInRedisCart instead.');
  }

  redisCart.updatedAt = new Date().toISOString();
  return redisCart;
}

/**
 * Add new item to Redis cart
 * @param redisCart - Redis cart (can be null)
 * @param foodId - Food ID
 * @param name - Food name
 * @param price - Food price
 * @param quantity - Quantity
 * @returns Updated Redis cart
 */
export function addItemInRedisCart(
  redisCart: RedisCart | null,
  foodId: string,
  name: string,
  price: number,
  quantity: number,
): RedisCart {
  if (!redisCart) {
    redisCart = {
      cartId: '', // Will be set by caller
      items: [],
      updatedAt: new Date().toISOString(),
    };
  }

  const existingItemIndex = redisCart.items.findIndex(item => item.foodId === foodId);
  
  if (existingItemIndex >= 0) {
    // Update existing item
    redisCart.items[existingItemIndex].quantity += quantity;
  } else {
    // Add new item
    redisCart.items.push({
      foodId,
      name,
      price,
      quantity,
    });
  }

  redisCart.updatedAt = new Date().toISOString();
  return redisCart;
}

/**
 * Remove item from Redis cart
 * @param redisCart - Redis cart
 * @param foodId - Food ID
 * @returns Updated Redis cart
 */
export function removeItemFromRedisCart(
  redisCart: RedisCart | null,
  foodId: string,
): RedisCart {
  if (!redisCart) {
    return {
      cartId: '', // Will be set by caller
      items: [],
      updatedAt: new Date().toISOString(),
    };
  }

  redisCart.items = redisCart.items.filter(item => item.foodId !== foodId);
  redisCart.updatedAt = new Date().toISOString();
  return redisCart;
}

/**
 * Clear Redis cart
 * @param redisCart - Redis cart (ignored, will be cleared)
 * @returns Empty Redis cart
 */
export function clearRedisCart(): RedisCart {
  return {
    cartId: '', // Will be set by caller
    items: [],
    updatedAt: new Date().toISOString(),
  };
}
