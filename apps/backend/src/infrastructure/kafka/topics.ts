export const KAFKA_TOPICS = {
  CART_EVENTS: 'cart-events',
  ORDER_EVENTS: 'order-events',
  PAYMENT_EVENTS: 'payment-events',
} as const;

export type KafkaTopic = typeof KAFKA_TOPICS[keyof typeof KAFKA_TOPICS];
