import csv
from pymongo import MongoClient, ASCENDING
from pymongo.errors import BulkWriteError
from datetime import datetime
import time

# MongoDB connection details
mongo_uri = "mongodb://admin:123@router01:27017,router02:27017/"
db_name = "ecommerce"
collection_name = "orders"

# Validation schema for the collection
orders_schema = {
    "$jsonSchema": {
        "bsonType": "object",
        "properties": {
            "order_id": {"bsonType": "string"},
            "customer_id": {"bsonType": "string"},
            "order_status": {"bsonType": "string"},
            "order_purchase_timestamp": {"bsonType": ["date", "null"]},
            "order_approved_at": {"bsonType": ["date", "null"]},
            "order_delivered_carrier_date": {"bsonType": ["date", "null"]},
            "order_delivered_customer_date": {"bsonType": ["date", "null"]},
            "order_estimated_delivery_date": {"bsonType": ["date", "null"]}
        },
    }
}

print(f"Connecting to MongoDB at {mongo_uri} ...")
start_time = time.time()
try:
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=10000)
    client.server_info()
    print("Connected to MongoDB.")
except Exception as e:
    print("Failed to connect to MongoDB:", e)
    exit(1)
print(f"Selecting database '{db_name}' and collection '{collection_name}' ...")
db = client[db_name]

# Create the collection with validation if it doesn't exist
if collection_name not in db.list_collection_names():
    print(f"Creating collection '{collection_name}' with validation schema ...")
    db.create_collection(collection_name, validator=orders_schema)
else:
    print(f"Updating validation schema for collection '{collection_name}' ...")
    db.command({
        "collMod": collection_name,
        "validator": orders_schema,
        "validationLevel": "moderate"
    })
collection = db[collection_name]

# Create indexes for performance and relations
print("Creating indexes ...")
collection.create_index([("order_id", ASCENDING)], unique=True)
collection.create_index([("customer_id", ASCENDING)])
# For a reference to order_items, create an index on order_id in both collections
# Foreign keys are not enforced in MongoDB, but you can create indexes for fast lookups

print("Indexes created.")

csv_file_path = "../dataset/olist_orders_dataset.csv"
print(f"Reading data from {csv_file_path} ...")
def parse_row(row):
    def parse_date(val):
        try:
            return datetime.strptime(val, "%Y-%m-%d %H:%M:%S")
        except Exception:
            return None
    return {
        "order_id": row["order_id"].strip('"'),
        "customer_id": row["customer_id"].strip('"'),
        "order_status": row["order_status"],
        "order_purchase_timestamp": parse_date(row["order_purchase_timestamp"]),
        "order_approved_at": parse_date(row["order_approved_at"]),
        "order_delivered_carrier_date": parse_date(row["order_delivered_carrier_date"]),
        "order_delivered_customer_date": parse_date(row["order_delivered_customer_date"]),
        "order_estimated_delivery_date": parse_date(row["order_estimated_delivery_date"])
    }

with open(csv_file_path, mode='r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    docs = []
    count = 0
    for row in csv_reader:
        docs.append(parse_row(row))
        count += 1
        if count % 1000 == 0:
            print(f"Parsed {count} rows ...")
    print(f"Parsed total {count} rows. Inserting into MongoDB ...")
    try:
        result = collection.insert_many(docs, ordered=False)
        print(f"Inserted {len(result.inserted_ids)} documents into '{collection_name}'.")
    except BulkWriteError as bwe:
        print("Some documents failed validation:", bwe.details)

print("Done. Closing MongoDB connection.")
client.close()
print(f"Script finished in {time.time() - start_time:.2f} seconds.")
