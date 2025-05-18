import csv
from pymongo import MongoClient, ASCENDING
from pymongo.errors import BulkWriteError
import time

# MongoDB connection details
mongo_uri = "mongodb://admin:123@router01:27017,router02:27017/"
db_name = "ecommerce"
collection_name = "products"

# Validation schema for the collection
products_schema = {
    "$jsonSchema": {
        "bsonType": "object",
        "properties": {
            "product_id": {"bsonType": ["string", "null"]},
            "product_category_name": {"bsonType": ["string", "null"]},
            "product_name_lenght": {"bsonType": ["int", "long", "null"]},
            "product_description_lenght": {"bsonType": ["int", "long", "null"]},
            "product_photos_qty": {"bsonType": ["int", "long", "null"]},
            "product_weight_g": {"bsonType": ["int", "long", "null"]},
            "product_length_cm": {"bsonType": ["int", "long", "null"]},
            "product_height_cm": {"bsonType": ["int", "long", "null"]},
            "product_width_cm": {"bsonType": ["int", "long", "null"]}
        },
        "additionalProperties": True
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
    db.create_collection(collection_name, validator=products_schema)
else:
    print(f"Updating validation schema for collection '{collection_name}' ...")
    db.command({
        "collMod": collection_name,
        "validator": products_schema,
        "validationLevel": "moderate"
    })
collection = db[collection_name]

# Create indexes for performance
print("Creating indexes ...")
collection.create_index([("product_id", ASCENDING)], unique=True)
collection.create_index([("product_category_name", ASCENDING)])
print("Indexes created.")

csv_file_path = "../dataset/olist_products_dataset.csv"
print(f"Reading data from {csv_file_path} ...")
def try_int(val):
    try:
        return int(val)
    except (ValueError, TypeError):
        return None

def parse_row(row):
    return {
        "product_id": row["product_id"].strip('"'),
        "product_category_name": row["product_category_name"],
        "product_name_lenght": try_int(row["product_name_lenght"]),
        "product_description_lenght": try_int(row["product_description_lenght"]),
        "product_photos_qty": try_int(row["product_photos_qty"]),
        "product_weight_g": try_int(row["product_weight_g"]),
        "product_length_cm": try_int(row["product_length_cm"]),
        "product_height_cm": try_int(row["product_height_cm"]),
        "product_width_cm": try_int(row["product_width_cm"])
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
