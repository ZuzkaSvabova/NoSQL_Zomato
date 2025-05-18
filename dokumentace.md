# MongoDB Cluster Dokumentace

## 1. Architektura

### 1.1. Schéma architektury

![MongoDB Cluster Architecture](https://raw.githubusercontent.com/minhhungit/mongodb-cluster-docker-compose/master/images/sharding-and-replica-sets.png)

### 1.2. Komponenty clusteru

#### Konfigurační servery (Config Servers)
- **configsvr01** - hlavní konfigurační server
- **configsvr02** - sekundární konfigurační server
- **configsvr03** - sekundární konfigurační server

#### Shardy (3x3 replika set)
1. **Shard 01** (rs-shard-01)
   - shard01-a (hlavní)
   - shard01-b (sekundární)
   - shard01-c (sekundární)

2. **Shard 02** (rs-shard-02)
   - shard02-a (hlavní)
   - shard02-b (sekundární)
   - shard02-c (sekundární)

3. **Shard 03** (rs-shard-03)
   - shard03-a (hlavní)
   - shard03-b (sekundární)
   - shard03-c (sekundární)

#### Routery (mongos)
- **router01** - hlavní router (port 27117)
- **router02** - sekundární router

## 2. Instalace a konfigurace

### 2.1. Docker compose

```yaml
services:
  # Router
  router01:
    image: mongo:latest
    container_name: router-01
    ports:
      - "27117:27017"
    volumes:
      - ./scripts:/scripts
      - mongodb_cluster_router01_db:/data/db
      - mongodb_cluster_router01_config:/data/configdb
    entrypoint: ["/scripts/entrypoint-route.sh"]

  # Config Servers
  configsvr01:
    image: mongo:latest
    container_name: mongo-config-01
    volumes:
      - ./scripts:/scripts
      - mongodb_cluster_configsvr01_db:/data/db
      - mongodb_cluster_configsvr01_config:/data/configdb
    entrypoint: ["/scripts/entrypoint-configserver.sh"]

  # Shards
  shard01-a:
    image: mongo:latest
    container_name: shard-01-node-a
    volumes:
      - ./scripts:/scripts
      - mongodb_cluster_shard01_a_db:/data/db
      - mongodb_cluster_shard01_a_config:/data/configdb
    entrypoint: ["/bin/sh", "/scripts/entrypoint-shard01.sh"]

  # ... ostatní služby
```

### 2.2. Inicializace clusteru

Cluster se inicializuje automaticky pomocí skriptů v `/scripts` složce:
- `entrypoint-route.sh` - inicializace routeru
- `entrypoint-configserver.sh` - inicializace konfiguračních serverů
- `entrypoint-shard01.sh`, `entrypoint-shard02.sh`, `entrypoint-shard03.sh` - inicializace shardů

## 3. Verifikace

### 3.1. Stav clusteru

```bash
docker exec -it router-01 bash -c "echo 'sh.status()' | mongosh --port 27017"
```

### 3.2. Stav replika setů

```bash
docker exec -it shard01-a bash -c "echo 'rs.status()' | mongosh --port 27017"
```

## 4. Přístup k databázi

MongoDB je dostupný na portu 27117:
- localhost:27117

## 5. Bezpečnostní poznámky

- Používá se Mongo DB verze: latest
- Data jsou uložena v Docker volumes
- Cluster je nakonfigurován s replikací a shardingem
- Všechny komponenty jsou nakonfigurovány s automatickým restartem (restart: always)
