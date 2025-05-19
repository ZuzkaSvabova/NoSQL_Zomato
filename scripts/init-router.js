sh.addShard("rs-shard-01/shard01-a:27017")
sh.addShard("rs-shard-01/shard01-b:27017")
sh.addShard("rs-shard-01/shard01-c:27017")
sh.addShard("rs-shard-02/shard02-a:27017")
sh.addShard("rs-shard-02/shard02-b:27017")
sh.addShard("rs-shard-02/shard02-c:27017")
sh.addShard("rs-shard-03/shard03-a:27017")
sh.addShard("rs-shard-03/shard03-b:27017")
sh.addShard("rs-shard-03/shard03-c:27017")

// ––– Zomato sharding
sh.enableSharding("zomatoDB");
sh.shardCollection("zomatoDB.restaurants", { restaurant_id: "hashed" });
sh.shardCollection("zomatoDB.users",       { user_id:       "hashed" });
sh.shardCollection("zomatoDB.orders",      { order_id:      "hashed" });