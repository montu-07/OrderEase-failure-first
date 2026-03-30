import { AddToCartDto, UpdateCartItemDto } from '@orderease/shared-contracts';
import { RedisCart } from './cart-transformers';

/**
 * Helper functions for cart mutations to avoid logic duplication
 */

export interface CartItemMutation {
  foodId: string;
  quantity: number;
  name?: string;
  price?: number;
}

/**
 * Add item to cart (Redis or DB format)
 */
export function addItemToCart(
  existingItems: CartItemMutation[],
  foodId: string,
  name: string,
  price: number,
  quantity: number
): CartItemMutation[] {
  const existingItem = existingItems.find(item => item.foodId === foodId);
  
  if (existingItem) {
    // Update existing item
    return existingItems.map(item =>
      item.foodId === foodId
        ? { ...item, quantity: item.quantity + quantity }
        : item
    );
  } else {
    // Add new item
    return [...existingItems, { foodId, name, price, quantity }];
  }
}

/**
 * Update item quantity in cart
 */
export function updateItemInCart(
  existingItems: CartItemMutation[],
  foodId: string,
  quantity: number
): CartItemMutation[] {
  if (quantity === 0) {
    // Remove item if quantity is 0
    return existingItems.filter(item => item.foodId !== foodId);
  }
  
  // Update existing item
  return existingItems.map(item =>
    item.foodId === foodId
      ? { ...item, quantity }
      : item
  );
}

/**
 * Remove item from cart
 */
export function removeItemFromCart(
  existingItems: CartItemMutation[],
  foodId: string
): CartItemMutation[] {
  return existingItems.filter(item => item.foodId !== foodId);
}

/**
 * Clear all items from cart
 */
export function clearCartItems(): CartItemMutation[] {
  return [];
}

/**
 * Transform Redis cart to mutation format
 */
export function redisCartToMutations(redisCart: RedisCart): CartItemMutation[] {
  return redisCart.items.map(item => ({
    foodId: item.foodId,
    quantity: item.quantity,
    name: item.name,
    price: item.price
  }));
}

/**
 * Transform mutation format to Redis cart
 */
export function mutationsToRedisCart(
  mutations: CartItemMutation[],
  cartId?: string,
  updatedAt?: string
): RedisCart {
  return {
    cartId: cartId || 'unknown',
    items: mutations.map(item => ({
      foodId: item.foodId,
      name: item.name || '',
      price: item.price || 0,
      quantity: item.quantity
    })),
    updatedAt: updatedAt || new Date().toISOString()
  };
}
