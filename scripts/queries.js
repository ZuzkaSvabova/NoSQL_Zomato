// Switch to the correct database
db = db.getSiblingDB('zomatoDB');

// queries.js
// Skript pro MongoDB shell, spustíte příkazem:
// mongo --quiet zomatoDB run_all_queries.js > all_queries_output.log

// 1) Vložení jednoho dokumentu do users
db.users.insertOne({
    user_id: 1001,
    name: "Novák",
    email: "novak@example.com",
    join_date: ISODate("2024-01-15"),
    loyalty_points: 200
});

// 2) Vložení více objednávek do orders
db.orders.insertMany([
    { order_id: 5001, user_id: 1001, restaurant_id: 120, total_amount: 350, order_date: ISODate("2024-03-10") },
    { order_id: 5002, user_id: 1002, restaurant_id: 85,  total_amount: 420, order_date: ISODate("2024-03-11") }
]);

// 3) Aktualizace bodů uživatele
db.users.updateOne(
    { user_id: 1001 },
    { $inc: { loyalty_points: 50 } }
);

// 4) Hromadná aktualizace objednávek
db.orders.updateMany(
    { total_amount: { $lt: 100 } },
    { $set: { total_amount: 100 } }
);

// 5) Smazání starých objednávek
db.orders.deleteMany(
    { order_date: { $lt: ISODate("2023-01-01") } }
);

// 6) Sloučení orders s agregací do nové kolekce
db.orders.aggregate([
    { $group: { _id: "$user_id", total_spent: { $sum: "$total_amount" } } },
    { $merge: { into: "user_spending", whenMatched: "replace" } }
]);

// 7) Průměrné hodnocení podle kuchyně
db.restaurants.aggregate([
    { $group: { _id: "$cuisine", avgRating: { $avg: "$rating" } } },
    { $sort: { avgRating: -1 } }
]);

// 8) Top 5 uživatelů podle utracené částky
db.orders.aggregate([
    { $group: { _id: "$user_id", spent: { $sum: "$total_amount" } } },
    { $sort: { spent: -1 } },
    { $limit: 5 },
    { $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "user_id",
        as: "user_info"
    }}
]);

// 9) Denní počet objednávek
db.orders.aggregate([
    { $project: { day: { $dateToString: { format: "%Y-%m-%d", date: "$order_date" } } } },
    { $group: { _id: "$day", count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
]);

// 10) Počet restaurací podle lokace
db.restaurants.aggregate([
    { $group: { _id: "$location", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
]);

// 11) Uživatelé bez objednávek
db.users.aggregate([
    { $lookup: { from: "orders", localField: "user_id", foreignField: "user_id", as: "orders" } },
    { $match: { orders: { $size: 0 } } }
]);

// 12) Průměrný počet objednávek na uživatele
db.orders.aggregate([
    { $group: { _id: "$user_id", count: { $sum: 1 } } },
    { $group: { _id: null, avgOrders: { $avg: "$count" } } }
]);

// 13) Vytvoření vnořených dokumentů order_items
db.orders.updateOne(
    { order_id: 2001 },
    { $set: { items: [ { item: "Sushi", qty: 2 }, { item: "Ramen", qty: 1 } ] } }
);

// 14) Výpis všech položek pro danou objednávku
db.orders.aggregate([
    { $match: { order_id: 2001 } },
    { $unwind: "$items" },
    { $project: { _id: 0, order_id: 1, item: "$items.item", qty: "$items.qty" } }
]);

// 15) Celkové množství položek za objednávky
db.orders.aggregate([
    { $unwind: "$items" },
    { $group: { _id: null, totalQty: { $sum: "$items.qty" } } }
]);

// 16) Počet typů položek na objednávku
db.orders.aggregate([
    { $unwind: "$items" },
    { $group: { _id: "$order_id", types: { $addToSet: "$items.item" } } },
    { $project: { _id: 1, nTypes: { $size: "$types" } } }
]);

// 17) Průměrná cena za položku
db.orders.aggregate([
    { $unwind: "$items" },
    { $group: { _id: "$items.item", avgQty: { $avg: "$items.qty" } } }
]);

// 18) Filtrace nested dokumentů
db.orders.aggregate([
    { $unwind: "$items" },
    { $match: { "items.qty": { $gte: 2 } } },
    { $project: { order_id: 1, item: "$items.item", qty: "$items.qty" } }
]);

// 19) Vytvoření jednoduchého indexu na name v restaurants
db.restaurants.createIndex({ name: 1 });

// 20) Vytvoření složeného indexu na user_id a order_date
db.orders.createIndex({ user_id: 1, order_date: -1 });

// 21) Textový index na sloupec cuisine
db.restaurants.createIndex({ cuisine: "text" });

// 22) Geospatial index (příklad, pokud máme souřadnice)
db.restaurants.createIndex({ location_coords: "2dsphere" });

// 23) Výpis všech indexů v orders
db.orders.getIndexes();

// 24) Smazání indexu user_id_1_order_date_-1
db.orders.dropIndex("user_id_1_order_date_-1");

// 25) Vytvoření kolekce s validačním schématem
db.createCollection("restaurants", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["id","name","cuisine","rating","location"],
        properties: {
          rating: { bsonType: "double", minimum: 0, maximum: 5 }
        }
      }
    }
});

// 26) Kontrola validačního pravidla
db.getCollectionInfos({ name: "restaurants" });

// 27) Inicializace replikační sady
rs.initiate({
    _id: "rs0",
    members: [
        { _id: 0, host: "host1:27017" },
        { _id: 1, host: "host2:27017" },
        { _id: 2, host: "host3:27017" }
    ]
});

// 28) Zobrazení stavu replicy
rs.status();

// 29) Zapnutí shardingu databáze
sh.enableSharding("zomatoDB");

// 30) Rozdělení kolekce orders podle user_id
sh.shardCollection("zomatoDB.orders", { user_id: "hashed" });

// Příklad nastavení profilování (POZOR: Může ovlivnit výkon!)
// db.setProfilingLevel(1, { slowms: 100 })
// Popis: Nastaví úroveň profilování na 1 (logovat pomalé operace) a prahovou hodnotu na 100 ms.
// db.setProfilingLevel(0) // Vypne profilování

// Pro tento skript pouze zobrazíme aktuální stav a příklad, jak by se nastavil.
print("\nPříklad nastavení profilování (pro logování operací pomalejších než 50ms):");
print("db.setProfilingLevel(1, { slowms: 50 })");
print("Pro vypnutí: db.setProfilingLevel(0)");

// Výsledky profilování se ukládají do systémové kolekce `system.profile`.
// Dotaz na profilované operace (pokud je profiler zapnutý):
// db.system.profile.find().sort({ts: -1}).limit(5).pretty();
// Pro účely tohoto skriptu vrátíme obsah `profiling_status` jako hlavní data.
// (Pokud byste chtěli ukázat data z system.profile, musel by být profiler aktivní a nějaké dotazy spuštěny)