import csv
from pymongo import MongoClient
from pymongo.errors import BulkWriteError
from datetime import datetime
import time

# MongoDB connection details
mongo_uri = "mongodb://admin:123@router01:27017,router02:27017/"
# If you need to specify the database in the URI, add '/ecommerce' at the end
db_name = "ecommerce"
collection_name = "order_items"

# Validation schema for the collection
order_items_schema = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": [
            "order_id", "order_item_id", "product_id", "seller_id", "shipping_limit_date", "price", "freight_value"
        ],
        "properties": {
            "order_id": {"bsonType": "string"},
            "order_item_id": {"bsonType": ["int"]},
            "product_id": {"bsonType": "string"},
            "seller_id": {"bsonType": "string"},
            "shipping_limit_date": {"bsonType": "date"},
            "price": {"bsonType": ["double", "decimal"]},
            "freight_value": {"bsonType": ["double", "decimal"]}
        }
    }
}

# Establish a connection to the MongoDB server with progress logging
print("Connecting to MongoDB at {}...".format(mongo_uri))
start_time = time.time()
try:
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=10000)
    # Trigger connection
    client.server_info()
    print("Connected to MongoDB.")
except Exception as e:
    print("Failed to connect to MongoDB:", e)
    exit(1)
print("Selecting database '{}' and collection '{}'...".format(db_name, collection_name))
db = client[db_name]

# Create the collection with validation if it doesn't exist
if collection_name not in db.list_collection_names():
    print("Creating collection '{}' with validation schema...".format(collection_name))
    db.create_collection(collection_name, validator=order_items_schema)
else:
    print("Updating validation schema for collection '{}'...".format(collection_name))
    db.command({
        "collMod": collection_name,
        "validator": order_items_schema,
        "validationLevel": "strict"
    })

collection = db[collection_name]

# Path to the CSV file
csv_file_path = "../dataset/olist_order_items_dataset.csv"
print(f"Reading data from {csv_file_path}...")
def parse_row(row):
    # Convert fields to appropriate types
    return {
        "order_id": row["order_id"],
        "order_item_id": int(row["order_item_id"]),
        "product_id": row["product_id"],
        "seller_id": row["seller_id"],
        "shipping_limit_date": datetime.strptime(row["shipping_limit_date"], "%Y-%m-%d %H:%M:%S"),
        "price": float(row["price"]),
        "freight_value": float(row["freight_value"])
    }

# Read the CSV file and insert data into MongoDB
with open(csv_file_path, mode='r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    docs = []
    count = 0
    for row in csv_reader:
        docs.append(parse_row(row))
        count += 1
        if count % 1000 == 0:
            print(f"Parsed {count} rows...")
    print(f"Parsed total {count} rows. Inserting into MongoDB...")
    try:
        result = collection.insert_many(docs, ordered=False)
        print(f"Inserted {len(result.inserted_ids)} documents into '{collection_name}'.")
    except BulkWriteError as bwe:
        print("Some documents failed validation:", bwe.details)

print("Done. Closing MongoDB connection.")
client.close()
print("Script finished in {:.2f} seconds.".format(time.time() - start_time))
