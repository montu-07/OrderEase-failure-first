export interface CartEvent {
  eventId: string;
  type: CartEventType;
  userId: string;
  payload: CartEventPayload;
  timestamp: number;
}

export enum CartEventType {
  CART_CREATED = 'CART_CREATED',
  CART_UPDATED = 'CART_UPDATED',
  CART_CLEARED = 'CART_CLEARED',
  ITEM_ADDED = 'ITEM_ADDED',
  ITEM_UPDATED = 'ITEM_UPDATED',
  ITEM_REMOVED = 'ITEM_REMOVED',
}

export interface CartEventPayload {
  items: CartItemPayload[];
  cartId?: string;
}

export interface CartItemPayload {
  foodId: string;
  quantity: number;
  price: number; // in cents
}

export class CartEventBuilder {
  static generateEventId(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  static createCartUpdatedEvent(
    userId: string,
    items: CartItemPayload[],
    cartId?: string
  ): CartEvent {
    return {
      eventId: this.generateEventId(),
      type: CartEventType.CART_UPDATED,
      userId,
      payload: {
        items,
        cartId,
      },
      timestamp: Date.now(),
    };
  }

  static createItemAddedEvent(
    userId: string,
    foodId: string,
    quantity: number,
    price: number,
    cartId?: string
  ): CartEvent {
    return {
      eventId: this.generateEventId(),
      type: CartEventType.ITEM_ADDED,
      userId,
      payload: {
        items: [{ foodId, quantity, price }],
        cartId,
      },
      timestamp: Date.now(),
    };
  }

  static createItemUpdatedEvent(
    userId: string,
    foodId: string,
    quantity: number,
    price: number,
    cartId?: string
  ): CartEvent {
    return {
      eventId: this.generateEventId(),
      type: CartEventType.ITEM_UPDATED,
      userId,
      payload: {
        items: [{ foodId, quantity, price }],
        cartId,
      },
      timestamp: Date.now(),
    };
  }

  static createItemRemovedEvent(
    userId: string,
    foodId: string,
    cartId?: string
  ): CartEvent {
    return {
      eventId: this.generateEventId(),
      type: CartEventType.ITEM_REMOVED,
      userId,
      payload: {
        items: [{ foodId, quantity: 0, price: 0 }],
        cartId,
      },
      timestamp: Date.now(),
    };
  }

  static createCartClearedEvent(userId: string, cartId?: string): CartEvent {
    return {
      eventId: this.generateEventId(),
      type: CartEventType.CART_CLEARED,
      userId,
      payload: {
        items: [],
        cartId,
      },
      timestamp: Date.now(),
    };
  }
}
