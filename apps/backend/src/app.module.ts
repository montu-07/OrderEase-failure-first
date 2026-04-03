import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from '@orderease/shared-database';
import { AuthModule } from './modules/auth';
import { AdminModule } from './modules/admin';
import { UserModule } from './modules/user';
import { PublicModule } from './modules/public';
import { FoodModule } from './modules/food';
import { OrderModule } from './modules/order';
import { PaymentModule } from './modules/payment';
import { CartModule } from './modules/cart/cart.module';
import { CartSyncModule } from './cart-sync/cart-sync.module';
import { WorkerModule } from './workers/worker.module';
import { HealthModule } from './health';
import { RedisModule } from './infrastructure/redis/redis.module';
import { KafkaModule } from './infrastructure/kafka/kafka.module';
import { appConfig, databaseConfig, jwtConfig, redisConfig, kafkaConfig } from '@orderease/shared-config';
import { AppLoggerService, RequestContextMiddleware } from './gateway';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Load environment configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, redisConfig, kafkaConfig],
    }),
    // Infrastructure modules
    DatabaseModule,
    RedisModule,
    KafkaModule,
    // Feature modules
    AuthModule,
    AdminModule,
    UserModule,
    PublicModule,
    FoodModule,
    CartModule,
    CartSyncModule,
    OrderModule,
    PaymentModule,
    WorkerModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, AppLoggerService],
  exports: [AppLoggerService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply request context middleware to all routes
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
