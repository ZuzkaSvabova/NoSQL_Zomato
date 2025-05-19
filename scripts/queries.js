// 30 netriviálních dotazů pro kolekce restaurants, users, orders v databázi zomatoDB
// spuštění: docker compose exec router01   mongosh --quiet     "mongodb://admin:123@localhost:27017/zomatoDB?authSource=admin"     /scripts/queries.js   > all_queries_output.log
// output: all_queries_output.log

// Připojení k databázi
db = db.getSiblingDB("zomatoDB");

// Pomocná funkce pro spouštění a logování výsledků
function run(label, fn) {
  print('\n=== ' + label + ' ===');
  try {
    const result = fn();
    if (Array.isArray(result)) printjson(result);
    else if (result && typeof result.toArray === 'function') printjson(result.toArray());
    else printjson(result);
  } catch (e) {
    print('Error in ' + label + ': ' + e);
  }
}

// === 1. Kategorie: Pokročilé CRUD ===

// 1.1 Top5 Restaurants by Order Volume
run('1.1 Top5 Restaurants by Order Volume', () => {
  const agg = db.orders.aggregate([
    { $group: { _id: '$r_id', ordersCount: { $sum: 1 } } },
    { $sort: { ordersCount: -1 } },
    { $limit: 5 },
    { $lookup: { from: 'restaurants', localField: '_id', foreignField: 'id', as: 'rest' } },
    { $unwind: '$rest' },
    { $project: { _id: 0, restaurant_id: '$_id', name: '$rest.name', ordersCount: 1 } }
  ]).toArray();
  return agg.length ? agg : db.restaurants.find({}, { id:1, name:1 }).limit(5).toArray();
});
// 1.2 Aggregation-Pipeline Update Aggregation-Pipeline Update
run('1.2 Pipeline UpdateMany', () => db.orders.updateMany(
  { total: { $gt: 30 } },
  [{ $set: { discounted_total: { $round: [{ $multiply: ["$total", 0.95] }, 2] } } }]
));

// 1.3 Archive & Delete Users (Preview s fallbackem + Execute)
run('1.3 Archive Preview', () => {
  const sample = db.users.find({}, { user_id:1, user_location:1 }).limit(5).toArray();
  return sample.length ? sample : db.orders.find({}, { order_id:1, user_id:1 }).limit(5).toArray();
});
run('1.3 Archive Execute', () => {
  const docs = db.users.aggregate([
    { $match: { user_location: { $exists: false } } }
  ]).toArray();
  db.users.aggregate([
    { $match: { user_location: { $exists: false } } },
    { $merge: { into: 'archived_users', whenMatched: 'keepExisting', whenNotMatched: 'insert' } }
  ]);
  const del = db.users.deleteMany({ user_location: { $exists: false } });
  return { archived: docs.length, deleted: del.deletedCount };
});

// 1.4 BulkWrite operace (ignoruje duplicity)
run('1.4 BulkWrite', () => db.restaurants.bulkWrite([
  { insertOne: { document: { id: 700 + new Date().getTime() % 100, name: "Bistro X", city: "Olomouc", cuisine: ["Fusion"] } } },
  { updateOne: { filter: { id: 400 }, update: { $set: { city: "Brno" } } } },
  { deleteOne: { filter: { id: 300 } } }
], { ordered: false }));

// 1.5 Update with Replace Pipeline + Upsert
run('1.5 Replace Pipeline', () => db.restaurants.updateOne(
  { id: 502 },
  [{ $replaceWith: {
      id: 502,
      name: { $concat: ["Restaurace Y (", "$name", ")"] },
      city: "Liberec",
      cuisine: ["International"]
    } }],
  { upsert: true }
));

// 1.6 Merge do summary (Preview + Execute bez itcount)
run('1.6 Merge Preview', () => db.orders.aggregate([
  { $group: { _id: "$user_id", total_spent: { $sum: "$total" }, count: { $sum: 1 } } },
  { $project: { user_id: "$_id", total_spent: 1, count: 1, _id: 0 } }
]).toArray());
run('1.6 Merge Execute', () => {
  const docs = db.orders.aggregate([
    { $group: { _id: "$user_id", total_spent: { $sum: "$total" }, count: { $sum: 1 } } },
    { $project: { user_id: "$_id", total_spent: 1, count: 1, _id: 0 } }
  ]).toArray();
  db.orders.aggregate([
    { $group: { _id: "$user_id", total_spent: { $sum: "$total" }, count: { $sum: 1 } } },
    { $project: { user_id: "$_id", total_spent: 1, count: 1, _id: 0 } },
    { $merge: { into: "orders_summary", on: "user_id", whenMatched: "replace", whenNotMatched: "insert" } }
  ]);
  return { mergedCount: docs.length };
});

// === 2. Kategorie: Agregační funkce ===

// 2.1 Unwind+Group+Sort
run('2.1 Unwind+Group+Sort', () => db.orders.aggregate([
  { $unwind: "$items" },
  { $group: { _id: "$user_id", avg_item_price: { $avg: "$items.price" } } },
  { $sort: { avg_item_price: -1 } }
]));

// 2.2 Lookup & Limit
run('2.2 Lookup & Limit', () => db.orders.aggregate([
  { $lookup: { from: "restaurants", localField: "r_id", foreignField: "id", as: "rest" } },
  { $unwind: "$rest" },
  { $limit: 5 },
  { $project: { order_id: 1, user_id: 1, "rest.name": 1, "rest.city": 1, total: 1 } }
]));

// 2.3 Facet+Sort
run('2.3 Facet+Sort', () => db.orders.aggregate([
  { $group: { _id: "$user_id", total_spent: { $sum: "$total" } } },
  { $sort: { total_spent: -1 } },
  { $facet: { top: [{ $limit: 5 }], low: [{ $sort: { total_spent: 1 } }, { $limit: 5 }] } }
]));

// 2.4 Bucket s robustní konverzí cuisine na pole
run('2.4 Bucket', () => db.restaurants.aggregate([
  { $project: {
      name: 1,
      cuisines: {
        $switch: {
          branches: [
            { case: { $isArray: "$cuisine" }, then: "$cuisine" },
            { case: { $eq: ["$cuisine", null] }, then: [] }
          ],
          default: { $split: ["$cuisine", ","] }
        }
      }
  } },
  { $bucket: { groupBy: { $size: "$cuisines" }, boundaries: [0,2,5,10], default: "Other",
      output: { count: { $sum: 1 }, names: { $push: "$name" } } } }
]));

// 2.5 SetWindowFields
run('2.5 SetWindowFields', () => db.orders.aggregate([
  { $setWindowFields: { partitionBy: null, sortBy: { order_date: 1 },
      output: { cumulative: { $sum: "$total", window: { documents: ["unbounded", "current"] } } } } }
]));

// 2.6 Order Count Top5
run('2.6 Order Count Top5', () => db.orders.aggregate([
  { $group: { _id: "$r_id", orderCount: { $sum: 1 } } },
  { $sort: { orderCount: -1 } },
  { $limit: 5 }
]));

// === 3. Kategorie: Konfigurace a indexy ===

// 3.1 CreateIndex
run('3.1 CreateIndex', () => db.restaurants.createIndex({ city: 1, cuisine: 1 }, { background: true }));

// 3.2 CollMod
run('3.2 CollMod', () => db.runCommand({ collMod: "orders",
  validator: { $jsonSchema: { bsonType: "object", required: ["order_id","user_id","r_id","order_date","total"],
      properties: { order_id: { bsonType: "int" }, user_id: { bsonType: "int" }, total: { bsonType: "double" } } } },
  validationLevel: "moderate"
}));

// 3.3 Shard Status
run('3.3 Shard Status', () => sh.status());

// 3.4 Create Shard Key Index
run('3.4 Create Shard Key Index', () => db.users.createIndex({ user_location: "hashed", email: 1 }));

// 3.5 ListIndexes
run('3.5 ListIndexes', () => db.restaurants.getIndexes());

// 3.6 DropIndex
run('3.6 Drop Restaurant Index', () => db.restaurants.dropIndex({ city: 1, cuisine: 1 }));

// === 4. Kategorie: Embedded dokumenty ===

// 4.1 Push Embedded
run('4.1 Push Embedded', () => db.orders.updateOne(
  { order_id: 10001, user_id: 501 },
  { $push: { items: { name: "Sushi", price: 12.99 } } }
));

// 4.2 ArrayFilters
run('4.2 ArrayFilters', () => db.orders.updateMany(
  { items: { $exists: true } },
  { $set: { "items.$[el].price": 9.99 } },
  { arrayFilters: [{ "el.price": { $gt: 10 } }] }
));

// 4.3 Project Slice (jen orders s polem items)
run('4.3 Project Slice', () => db.orders.aggregate([
  { $match: { items: { $type: "array" } } },
  { $project: { order_id: 1,
      top2: { $slice: [{ $reverseArray: { $sortArray: { input: "$items", sortBy: { price: 1 } } } }, 2] }
  } }
]));

// 4.4 Unset Embedded
run('4.4 Unset Embedded', () => db.orders.aggregate([
  { $match: { total: { $exists: true } } },
  { $unset: "items" },
  { $limit: 5 }
]));

// 4.5 Filter Reviews (robustní konverze cuisine na pole a filtrování)
run('4.5 Filter Reviews', () => db.restaurants.aggregate([
  { $project: {
      id: 1,
      cuisines: { $cond: [{ $isArray: "$cuisine" }, "$cuisine", { $split: ["$cuisine", ","] }] }
    }
  },
  { $match: { $expr: { $gt: [{ $size: "$cuisines" }, 0] } } },
  { $project: { id: 1, cuisineCount: { $size: "$cuisines" } } },
  { $limit: 5 }
]));

// 4.6 MergeObjects Sample (orders+restaurants merge jako náhrada)
run('4.6 MergeObjects Sample', () => db.orders.aggregate([
  { $lookup: { from: "restaurants", localField: "r_id", foreignField: "id", as: "rest" } },
  { $unwind: "$rest" },
  { $project: { order_id: 1, user_id: 1, merged: { $mergeObjects: ["$$ROOT", "$rest"] } } },
  { $limit: 5 }
]).toArray());

// === 5. Kategorie: Cluster / replika set & sharding ===

// 5.1 ListDatabases
run('5.1 ListDatabases', () => db.adminCommand({ listDatabases: 1 }));

// 5.2 Shard Status
run('5.2 Shard Status', () => sh.status(true));

// 5.3 IndexStats
run('5.3 IndexStats', () => db.orders.aggregate([{ $indexStats: {} }]).toArray());

// 5.4 ServerMetrics
run('5.4 ServerMetrics', () => db.adminCommand({ serverStatus: 1 }).metrics);

// 5.5 Balancer State
run('5.5 Balancer State', () => sh.getBalancerState());

// 5.6 Balancer Activity
run('5.6 Balancer Activity', () => ({ balancer: db.adminCommand({ balancerStatus: 1 }), ops: db.currentOp({ $or: [{ msg: /moveChunk/ }] }) }));
