import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private redis: Redis;
  private isInitialized = false;
  private readonly scriptsPath = path.join(__dirname, 'scripts');

  constructor(private readonly configService: ConfigService) {
    this.initializeRedis();
  }

  private async initializeRedis(): Promise<void> {
    try {
      const redisConfig = this.configService.get('redis');
      this.logger.log('Initializing Redis connection...');
      this.logger.log(`Redis config: ${JSON.stringify(redisConfig)}`);

      this.redis = new Redis({
        host: redisConfig.host,
        port: redisConfig.port,
        maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
        lazyConnect: true,
        connectTimeout: redisConfig.connectTimeout,
        commandTimeout: redisConfig.commandTimeout,
      });

      this.redis.on('connect', () => {
        this.logger.log('Redis connected successfully');
        this.isInitialized = true;
      });

      this.redis.on('ready', () => {
        this.logger.log('Redis ready for operations');
      });

      this.redis.on('error', (error) => {
        this.logger.error('Redis connection error', error);
        this.isInitialized = false;
      });

      await this.redis.connect();
      
      const pong = await this.redis.ping();
      this.logger.log(`Redis ping response: ${pong}`);
    } catch (error) {
      this.logger.error('Failed to initialize Redis', error);
      this.isInitialized = false;
    }
  }

  /**
   * Execute Lua script atomically
   */
  async executeLua(
    scriptName: string,
    keys: string[],
    args: string[]
  ): Promise<any> {
    if (!this.redis || !this.isInitialized) {
      throw new Error('Redis not initialized');
    }

    try {
      const scriptPath = path.join(this.scriptsPath, scriptName);
      const script = fs.readFileSync(scriptPath, 'utf8');
      
      this.logger.debug(`Executing Lua script: ${scriptName}`);
      this.logger.debug(`Keys: ${JSON.stringify(keys)}`);
      this.logger.debug(`Args: ${JSON.stringify(args)}`);

      const result = await this.redis.eval(script, keys.length, ...keys, ...args);
      
      this.logger.debug(`Script result: ${result}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to execute Lua script: ${scriptName}`, error);
      throw error;
    }
  }

  /**
   * Get value from Redis
   */
  async get(key: string): Promise<any> {
    if (!this.redis || !this.isInitialized) {
      return null;
    }

    try {
      const value = await this.redis.get(key);
      if (value) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return null;
    } catch (error) {
      this.logger.error(`Failed to get Redis key: ${key}`, error);
      return null;
    }
  }

  /**
   * Set value in Redis
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
      if (ttl) {
        await this.redis.setex(key, ttl, serializedValue);
      } else {
        await this.redis.set(key, serializedValue);
      }
    } catch (error) {
      this.logger.error(`Failed to set Redis key: ${key}`, error);
      throw error;
    }
  }

  /**
   * Delete key from Redis
   */
  async del(key: string): Promise<void> {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(`Failed to delete Redis key: ${key}`, error);
      throw error;
    }
  }

  /**
   * Add member to Redis set
   */
  async sadd(key: string, member: string): Promise<void> {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      await this.redis.sadd(key, member);
    } catch (error) {
      this.logger.error(`Failed to add to Redis set: ${key}`, error);
      throw error;
    }
  }

  /**
   * Get all members of Redis set
   */
  async smembers(key: string): Promise<string[]> {
    if (!this.redis || !this.isInitialized) {
      return [];
    }

    try {
      return await this.redis.smembers(key);
    } catch (error) {
      this.logger.error(`Failed to get Redis set members: ${key}`, error);
      return [];
    }
  }

  /**
   * Remove member from Redis set
   */
  async srem(key: string, member: string): Promise<boolean> {
    if (!this.redis || !this.isInitialized) {
      return false;
    }

    try {
      const result = await this.redis.srem(key, member);
      return result > 0;
    } catch (error) {
      this.logger.error(`Failed to remove from Redis set: ${key}`, error);
      return false;
    }
  }

  /**
   * Check if Redis is available
   */
  isAvailable(): boolean {
    return this.isInitialized && this.redis?.status === 'ready';
  }

  /**
   * Reset TTL for a key
   */
  async resetTTL(key: string, ttl: number): Promise<void> {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      await this.redis.expire(key, ttl);
    } catch (error) {
      this.logger.error(`Failed to reset TTL for key: ${key}`, error);
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.isInitialized = false;
    }
  }
}
