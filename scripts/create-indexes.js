// 1) Switch to the correct database
db = db.getSiblingDB('zomatoDB');

sh.enableSharding("zomatoDB");

db.restaurants.drop();
db.users.drop();
db.orders.drop();

// 2) Restaurants
db.restaurants.createIndex({ id: 1 },   { unique: true });
db.restaurants.createIndex({ city: 1 });
db.restaurants.createIndex({ cuisine: 1 });

// 3) Users
db.users.createIndex({ user_id: 1 }, { unique: true });
db.users.createIndex({ email: 1 });
db.users.createIndex({ name: 1 });

// 4) Orders
db.orders.createIndex({ user_id: 1 });
db.orders.createIndex({ r_id: 1 });
db.orders.createIndex({ order_date: 1 });

// ––– Zomato sharding
sh.shardCollection("zomatoDB.restaurants", { id: "hashed" });
sh.shardCollection("zomatoDB.users",       { user_id:       "hashed" });
sh.shardCollection("zomatoDB.orders",      { user_id:      "hashed" });