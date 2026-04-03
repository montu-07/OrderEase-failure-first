-- cart-remove.lua
-- Atomic cart item removal with timestamp update
-- KEYS[1] = cart key (e.g., "cart:user123")
-- ARGV[1] = foodId
-- ARGV[2] = current timestamp (Unix timestamp)

local cartKey = KEYS[1]
local foodId = ARGV[1]
local timestamp = ARGV[2]

-- Get existing cart
local cart = redis.call('GET', cartKey)
if not cart then
    error('Cart not found')
end

cart = cjson.decode(cart)

-- Ensure items array exists
if not cart.items then
    cart.items = {}
end

-- Find and remove item
local found = false
local newItems = {}
for i, item in ipairs(cart.items) do
    if item.foodId ~= foodId then
        table.insert(newItems, item)
    else
        found = true
    end
end

-- Error if item not found
if not found then
    error('Item not found in cart: ' .. foodId)
end

-- Update cart with new items
cart.items = newItems

-- Update timestamp
cart.updatedAt = tonumber(timestamp)

-- Save cart
redis.call('SET', cartKey, cjson.encode(cart))

-- Return success with updated cart
return cjson.encode(cart)
