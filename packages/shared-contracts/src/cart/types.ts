/**
 * Shared cart types for Redis and database transformations
 * Ensures type safety across the monorepo
 */

export interface RedisCartItem {
  foodId: string;
  quantity: number;
  price: number; // Price in cents (integer)
}

export interface RedisCart {
  cartId?: string;
  items: RedisCartItem[];
  updatedAt: number; // Unix timestamp
}

export interface CartMutation {
  foodId: string;
  quantity: number;
  price?: number; // Price in cents (integer)
}

/**
 * Validation helpers for Redis cart data
 */
export function validateRedisCart(redisCart: unknown): redisCart is RedisCart {
  if (!redisCart || typeof redisCart !== 'object') {
    return false;
  }

  const cart = redisCart as Record<string, unknown>;
  
  // Check items array
  if (!cart.items || !Array.isArray(cart.items)) {
    return false;
  }

  // Check updatedAt timestamp
  if (typeof cart.updatedAt !== 'number') {
    return false;
  }

  // Check cartId (optional)
  if (cart.cartId !== undefined && typeof cart.cartId !== 'string') {
    return false;
  }

  // Validate each item
  for (const item of cart.items) {
    if (!item || typeof item !== 'object') {
      return false;
    }
    
    const cartItem = item as Record<string, unknown>;
    
    if (typeof cartItem.foodId !== 'string' ||
        typeof cartItem.quantity !== 'number' ||
        typeof cartItem.price !== 'number') {
      return false;
    }
    
    // Validate quantity is positive integer
    if (!Number.isInteger(cartItem.quantity) || cartItem.quantity <= 0) {
      return false;
    }
    
    // Validate price is non-negative integer
    if (!Number.isInteger(cartItem.price) || cartItem.price < 0) {
      return false;
    }
  }

  return true;
}

/**
 * Validate cart mutation data
 */
export function validateCartMutation(mutation: unknown): mutation is CartMutation {
  if (!mutation || typeof mutation !== 'object') {
    return false;
  }

  const item = mutation as Record<string, unknown>;
  
  if (typeof item.foodId !== 'string' ||
      typeof item.quantity !== 'number') {
    return false;
  }

  // Validate quantity is positive integer
  if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
    return false;
  }

  // Validate price if present
  if (item.price !== undefined) {
    if (typeof item.price !== 'number' || 
        !Number.isInteger(item.price) || 
        item.price < 0) {
      return false;
    }
  }

  return true;
}
