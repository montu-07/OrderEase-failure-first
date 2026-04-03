/**
 * Type-safe cart transformation utilities
 * Converts between Redis format and database format
 */

import { RedisCart, RedisCartItem, CartMutation, validateRedisCart, validateCartMutation } from './types';

// Database interface types (matching Prisma schema)
export interface DbCart {
  id?: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbCartItem {
  foodId: string;
  quantity: number;
  cartId: string;
}

/**
 * Transform Redis cart to database format
 * Used by CartSyncService for syncing Redis data to PostgreSQL
 */
export function mapRedisCartToDb(
  redisCart: RedisCart,
  userId: string
): {
  cart: DbCart;
  items: DbCartItem[];
} {
  // Validate input
  if (!validateRedisCart(redisCart)) {
    throw new Error('Invalid Redis cart format: validation failed');
  }

  if (!redisCart.cartId) {
    throw new Error('Redis cart must have cartId for database sync');
  }

  // Transform cart data
  const cart: DbCart = {
    id: redisCart.cartId,
    userId,
    createdAt: new Date(redisCart.updatedAt),
    updatedAt: new Date(redisCart.updatedAt),
  };

  // Transform cart items
  const items: DbCartItem[] = redisCart.items.map(({ foodId, quantity }) => ({
    foodId,
    quantity,
    cartId: redisCart.cartId!, // Non-null assertion validated above
    // Explicitly exclude price field - CartItem table doesn't have it
  }));

  return { cart, items };
}

/**
 * Transform database cart to Redis format
 * Used by CartService for caching database data in Redis
 */
export function mapDbCartToRedis(
  dbCart: {
    id: string;
    userId: string;
    items: Array<{
      foodId: string;
      quantity: number;
    }>;
    createdAt: Date;
    updatedAt: Date;
  }
): RedisCart {
  // Validate input
  if (!dbCart || typeof dbCart !== 'object') {
    throw new Error('Invalid database cart format');
  }

  if (!dbCart.id || !dbCart.userId) {
    throw new Error('Database cart must have id and userId');
  }

  if (!Array.isArray(dbCart.items)) {
    throw new Error('Database cart items must be an array');
  }

  // Transform to Redis format
  const redisCart: RedisCart = {
    cartId: dbCart.id,
    items: dbCart.items.map((item) => ({
      foodId: item.foodId,
      quantity: item.quantity,
    })),
    updatedAt: dbCart.updatedAt.getTime(), // Unix timestamp
  };

  // Validate output
  if (!validateRedisCart(redisCart)) {
    throw new Error('Failed to create valid Redis cart from database data');
  }

  return redisCart;
}

/**
 * Transform cart mutations to Redis cart format
 * Used by CartService for updating Redis cart data
 */
export function mutationsToRedisCart(
  mutations: CartMutation[],
  cartId?: string
): RedisCart {
  // Validate mutations
  if (!Array.isArray(mutations)) {
    throw new Error('Mutations must be an array');
  }

  for (const mutation of mutations) {
    if (!validateCartMutation(mutation)) {
      throw new Error(`Invalid cart mutation: ${JSON.stringify(mutation)}`);
    }
  }

  // Create Redis cart
  const redisCart: RedisCart = {
    cartId,
    items: mutations.map((mutation) => ({
      foodId: mutation.foodId,
      quantity: mutation.quantity,
    })),
    updatedAt: Date.now(), // Current timestamp
  };

  // Validate output
  if (!validateRedisCart(redisCart)) {
    throw new Error('Failed to create valid Redis cart from mutations');
  }

  return redisCart;
}

/**
 * Transform Redis cart to cart mutations
 * Used by CartService for extracting mutations from Redis cart
 */
export function redisCartToMutations(redisCart: RedisCart): CartMutation[] {
  // Validate input
  if (!validateRedisCart(redisCart)) {
    throw new Error('Invalid Redis cart format for mutation extraction');
  }

  // Transform to mutations
  return redisCart.items.map((item): CartMutation => ({
    foodId: item.foodId,
    quantity: item.quantity,
  }));
}

/**
 * Check if Redis cart is empty
 */
export function isRedisCartEmpty(redisCart: RedisCart): boolean {
  if (!validateRedisCart(redisCart)) {
    throw new Error('Invalid Redis cart format for emptiness check');
  }
  
  return redisCart.items.length === 0;
}

/**
 * Create empty Redis cart
 */
export function createEmptyRedisCart(cartId?: string): RedisCart {
  return {
    cartId,
    items: [],
    updatedAt: Date.now(),
  };
}
