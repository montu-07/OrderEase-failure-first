-- cart-update.lua
-- Atomic cart item quantity update with timestamp update
-- KEYS[1] = cart key (e.g., "cart:user123")
-- ARGV[1] = foodId
-- ARGV[2] = new quantity (number)
-- ARGV[3] = price (number, in cents)
-- ARGV[4] = current timestamp (Unix timestamp)

local cartKey = KEYS[1]
local foodId = ARGV[1]
local quantity = tonumber(ARGV[2])
local price = tonumber(ARGV[3])
local timestamp = ARGV[4]

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

-- Find and update existing item
local found = false
for i, item in ipairs(cart.items) do
    if item.foodId == foodId then
        item.quantity = quantity
        item.price = price
        found = true
        break
    end
end

-- Error if item not found
if not found then
    error('Item not found in cart: ' .. foodId)
end

-- Remove item if quantity is 0
if quantity <= 0 then
    local newItems = {}
    for i, item in ipairs(cart.items) do
        if item.foodId ~= foodId then
            table.insert(newItems, item)
        end
    end
    cart.items = newItems
end

-- Update timestamp
cart.updatedAt = tonumber(timestamp)

-- Save cart
redis.call('SET', cartKey, cjson.encode(cart))

-- Return success with updated cart
return cjson.encode(cart)
