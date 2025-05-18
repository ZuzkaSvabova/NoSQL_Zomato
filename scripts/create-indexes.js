// Switch to the correct database
db = db.getSiblingDB('ecommerce');

// Orders collection
db.orders.createIndex({ order_id: 1 }, { unique: true });
db.orders.createIndex({ customer_id: 1 });

// Products collection
db.products.createIndex({ product_id: 1 }, { unique: true });
db.products.createIndex({ product_category_name: 1 });

// Order Items collection
db.order_items.createIndex({ order_item_id: 1 });
db.order_items.createIndex({ order_id: 1 }, { unique: true });
db.order_items.createIndex({ product_id: 1 });
