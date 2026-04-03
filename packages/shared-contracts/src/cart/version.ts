/**
 * Redis cart version helper for race-condition safe operations
 * Prevents dirty flag removal during concurrent cart updates
 */

import { RedisCart, validateRedisCart } from './types';

// Define RedisService interface for shared package usage
export interface IRedisService {
  isAvailable(): boolean;
  get(key: string): Promise<any>;
  srem(key: string, member: string): Promise<boolean>;
}

/**
 * Get cart version (updatedAt timestamp) safely
 * Returns null if cart doesn't exist or is invalid
 */
export async function getCartVersion(
  userId: string,
  redisService: IRedisService
): Promise<number | null> {
  try {
    if (!redisService.isAvailable()) {
      return null;
    }

    const redisKey = `cart:${userId}`; // Inline key generation
    const redisCart = await redisService.get(redisKey);

    if (!redisCart) {
      return null;
    }

    // Validate structure before accessing updatedAt
    if (!validateRedisCart(redisCart)) {
      return null;
    }

    return redisCart.updatedAt;
  } catch (error) {
    return null; // Fail safe - return null on any error
  }
}

/**
 * Check if cart version changed between two reads
 */
export function hasCartVersionChanged(
  beforeVersion: number | null,
  afterVersion: number | null
): boolean {
  if (beforeVersion === null || afterVersion === null) {
    return true; // Treat null as changed
  }
  
  return beforeVersion !== afterVersion;
}

/**
 * Safely remove dirty flag only if version unchanged
 */
export async function safeRemoveDirtyFlag(
  userId: string,
  beforeVersion: number | null,
  redisService: IRedisService
): Promise<{ removed: boolean; reason: string }> {
  try {
    const afterVersion = await getCartVersion(userId, redisService);

    if (hasCartVersionChanged(beforeVersion, afterVersion)) {
      return {
        removed: false,
        reason: `Cart version changed during sync (before: ${beforeVersion}, after: ${afterVersion})`
      };
    }

    // Safe to remove dirty flag
    await redisService.srem('cart:dirty_users', userId);
    return {
      removed: true,
      reason: 'Cart version unchanged, dirty flag removed safely'
    };
  } catch (error) {
    return {
      removed: false,
      reason: `Failed to check cart version: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
