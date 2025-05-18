def fetch_order_items(db):
    """Fetches order items and returns them as a Pandas DataFrame."""
    # "order_id","order_item_id","product_id","seller_id","shipping_limit_date","price","freight_value"
    # "00010242fe8c5a6d1ba2dd792cb16214",1,"4244733e06e7ecb4970a6e2683c13e61","48436dade18ac8b2bce089ec2a041202",2017-09-19 09:45:35,58.90,13.29
    if db is None: return pd.DataFrame()
    order_items_data = list(db["order_items"].find({}, {"_id": 0})) # Exclude Mongo's _id
    df = pd.DataFrame(order_items_data)
    if not df.empty:
        df['price'] = pd.to_numeric(df['price'], errors='coerce')
        df['freight_value'] = pd.to_numeric(df['freight_value'], errors='coerce')
        df['shipping_limit_date'] = pd.to_datetime(df['shipping_limit_date'], errors='coerce')
    return df

def fetch_orders(db):
    """Fetches orders and returns them as a Pandas DataFrame."""
    # "order_id","customer_id","order_status","order_purchase_timestamp","order_approved_at","order_delivered_carrier_date","order_delivered_customer_date","order_estimated_delivery_date"
    # e481f51cbdc54678b7cc49136f2d6af7,"9ef432eb6251297304e76186b10a928d",delivered,2017-10-02 10:56:33,2017-10-02 11:07:15,2017-10-04 19:55:00,2017-10-10 21:25:13,2017-10-18 00:00:00
    if db is None: return pd.DataFrame()
    orders_data = list(db["orders"].find({}, {"_id": 0}))
    df = pd.DataFrame(orders_data)
    if not df.empty:
        date_columns = ["order_purchase_timestamp", "order_approved_at",
                        "order_delivered_carrier_date", "order_delivered_customer_date",
                        "order_estimated_delivery_date"]
        for col in date_columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')
    return df

def fetch_products(db):
    """Fetches products and returns them as a Pandas DataFrame."""
    # "product_id","product_category_name","product_name_lenght","product_description_lenght","product_photos_qty","product_weight_g","product_length_cm","product_height_cm","product_width_cm"
    # "1e9e8ef04dbcff4541ed26657ea517e5",perfumaria,40,287,1,225,16,10,14
    if db is None: return pd.DataFrame()
    products_data = list(db["products"].find({}, {"_id": 0}))
    df = pd.DataFrame(products_data)
    if not df.empty:
        numeric_cols = ['product_name_lenght', 'product_description_lenght', 'product_photos_qty',
                        'product_weight_g', 'product_length_cm', 'product_height_cm', 'product_width_cm']
        for col in numeric_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    return df