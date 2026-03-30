/**
 * Cart mutation helpers for type-safe cart operations
 * Shared across the monorepo to avoid duplication
 */

import { CartMutation } from './types';

/**
 * Add item to cart mutations
 */
export function addItemToCart(
  mutations: CartMutation[],
  foodId: string,
  quantity: number,
  price?: number
): CartMutation[] {
  // Validate inputs
  if (quantity <= 0) {
    throw new Error('Quantity must be positive');
  }

  // Check if item already exists
  const existingIndex = mutations.findIndex(item => item.foodId === foodId);
  
  if (existingIndex >= 0) {
    // Update existing item
    const updatedMutations = [...mutations];
    updatedMutations[existingIndex] = {
      ...updatedMutations[existingIndex],
      quantity: updatedMutations[existingIndex].quantity + quantity,
      price: price ?? updatedMutations[existingIndex].price,
    };
    return updatedMutations;
  } else {
    // Add new item
    return [...mutations, {
      foodId,
      quantity,
      price,
    }];
  }
}

/**
 * Update item quantity in cart mutations
 */
export function updateItemInCart(
  mutations: CartMutation[],
  foodId: string,
  quantity: number
): CartMutation[] {
  // Validate inputs
  if (quantity <= 0) {
    throw new Error('Quantity must be positive');
  }

  // Find and update item
  const existingIndex = mutations.findIndex(item => item.foodId === foodId);
  
  if (existingIndex >= 0) {
    const updatedMutations = [...mutations];
    updatedMutations[existingIndex] = {
      ...updatedMutations[existingIndex],
      quantity,
    };
    return updatedMutations;
  } else {
    throw new Error(`Item ${foodId} not found in cart`);
  }
}

/**
 * Remove item from cart mutations
 */
export function removeItemFromCart(
  mutations: CartMutation[],
  foodId: string
): CartMutation[] {
  // Filter out the item
  const filteredMutations = mutations.filter(item => item.foodId !== foodId);
  
  if (filteredMutations.length === mutations.length) {
    throw new Error(`Item ${foodId} not found in cart`);
  }
  
  return filteredMutations;
}

/**
 * Clear all items from cart mutations
 */
export function clearCartItems(): CartMutation[] {
  return [];
}
