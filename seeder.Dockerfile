FROM python:3.10-slim

WORKDIR /app

# COPY scripts /scripts
# COPY dataset /dataset

RUN pip install pymongo
