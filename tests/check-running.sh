docker exec -it mongo-config-01 bash -c "echo 'rs.status()' | mongosh --port 27017 -u 'lukas' -p '123' --authenticationDatabase admin"

docker exec -it shard-01-node-a bash -c "echo 'rs.help()' | mongosh --port 27017 -u 'lukas' -p '123' --authenticationDatabase admin"
docker exec -it shard-01-node-a bash -c "echo 'rs.status()' | mongosh --port 27017 -u 'lukas' -p '123' --authenticationDatabase admin" 
docker exec -it shard-01-node-a bash -c "echo 'rs.printReplicationInfo()' | mongosh --port 27017 -u 'lukas' -p '123' --authenticationDatabase admin" 
docker exec -it shard-01-node-a bash -c "echo 'rs.printSecondaryReplicationInfo()' | mongosh --port 27017 -u 'lukas' -p '123' --authenticationDatabase admin"