#!/bin/bash
// Vytvoření admin uživatele pro celý cluster
mongosh <<EOF
use admin;
db.createUser({user: "admin", pwd: "123", roles:[{role: "root", db: "admin"}]});
exit;
EOF