import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.schema';

export default registerAs('redis', () => {
  const env = validateEnv();
  
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
    commandTimeout: 5000,
  };
});
