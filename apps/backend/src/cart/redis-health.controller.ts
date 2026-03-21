/**
 * Redis Health Controller
 * Provides endpoints to test Redis connectivity and operations
 */

import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { RedisService } from './redis.service';

@Controller('redis-health')
export class RedisHealthController {
  constructor(private readonly redisService: RedisService) {}

  @Get()
  async checkRedis() {
    const isAvailable = this.redisService.isAvailable();
    
    return {
      status: isAvailable ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      message: isAvailable 
        ? 'Redis is available and ready for operations'
        : 'Redis is not available. Cart operations will use database only.',
    };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testRedisOperations() {
    const testKey = 'test-key';
    const testValue = { message: 'Hello Redis!', timestamp: new Date().toISOString() };
    
    try {
      // Test SET operation
      const setResult = await this.redisService.set(testKey, testValue);
      
      // Test GET operation
      const getResult = await this.redisService.get(testKey);
      
      // Test DEL operation
      const delResult = await this.redisService.del(testKey);
      
      const success = setResult && getResult && getResult.message === testValue.message && delResult;
      
      return {
        success,
        operations: {
          set: setResult,
          get: getResult,
          delete: delResult,
        },
        timestamp: new Date().toISOString(),
        message: success 
          ? 'All Redis operations working correctly'
          : 'Redis operations test failed',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        message: 'Redis operations test failed',
      };
    }
  }
}
