import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.schema';

export default registerAs('kafka', () => {
  const env = validateEnv();
  
  const saslConfig = env.KAFKA_SASL_MECHANISM && env.KAFKA_SASL_USERNAME && env.KAFKA_SASL_PASSWORD
    ? {
        mechanism: env.KAFKA_SASL_MECHANISM,
        username: env.KAFKA_SASL_USERNAME,
        password: env.KAFKA_SASL_PASSWORD,
      }
    : undefined;
  
  return {
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS,
    consumerGroupId: env.KAFKA_CONSUMER_GROUP_ID,
    ssl: env.KAFKA_SSL,
    sasl: saslConfig,
  };
});
