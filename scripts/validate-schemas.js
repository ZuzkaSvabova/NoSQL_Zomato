// Tento skript načte všechny JSON soubory ze složky /dataset a validuje jejich obsah podle schémat kolekcí v MongoDB.
// Spouštějte pomocí: node scripts/validate-schemas.js

const fs = require('fs');
const path = require('path');

// Definice schémat pro validaci (stejná jako v kolekcích)
const schemas = {
  restaurants: {
    bsonType: "object",
    required: ["id","name","location","cuisines","rating","reviews_count","opening_hours"],
    properties: {
      id:            { bsonType: "int" },
      name:          { bsonType: "string" },
      location: {
        bsonType: "object",
        required: ["address","city","country"],
        properties: {
          address: { bsonType: "string" },
          city:    { bsonType: "string" },
          country: { bsonType: "string" }
        }
      },
      cuisines: {
        bsonType: "array",
        items: { bsonType: "string" }
      },
      rating:        { bsonType: "double", minimum: 0, maximum: 5 },
      reviews_count: { bsonType: "int", minimum: 0 },
      opening_hours: {
        bsonType: "object",
        required: ["mon-fri","sat-sun"],
        properties: {
          "mon-fri": { bsonType: "string" },
          "sat-sun": { bsonType: "string" }
        }
      }
    }
  },
  users: {
    bsonType: "object",
    required: ["user_id","name","email","preferences","joined"],
    properties: {
      user_id:    { bsonType: "int" },
      name:       { bsonType: "string" },
      email:      { bsonType: "string", pattern: "^.+@.+\\..+$" },
      preferences: {
        bsonType: "object",
        required: ["vegan","allergies"],
        properties: {
          vegan:     { bsonType: "bool" },
          allergies: {
            bsonType: "array",
            items: { bsonType: "string" }
          }
        }
      },
      joined:     { bsonType: "date" }
    }
  },
  orders: {
    bsonType: "object",
    required: ["order_id","user_id","restaurant_id","items","total","ordered_at","delivered_at"],
    properties: {
      order_id:      { bsonType: "int" },
      user_id:       { bsonType: "int" },
      restaurant_id: { bsonType: "int" },
      items: {
        bsonType: "array",
        minItems: 1,
        items: {
          bsonType: "object",
          required: ["dish","qty","price"],
          properties: {
            dish:  { bsonType: "string" },
            qty:   { bsonType: "int", minimum: 1 },
            price: { bsonType: "double", minimum: 0 }
          }
        }
      },
      total:         { bsonType: "double", minimum: 0 },
      ordered_at:    { bsonType: "date" },
      delivered_at:  { bsonType: "date" }
    }
  }
};

// Pomocná funkce pro validaci typu (zjednodušená pro běžné případy)
function checkType(value, bsonType) {
  if (bsonType === "int") return Number.isInteger(value);
  if (bsonType === "double") return typeof value === "number";
  if (bsonType === "string") return typeof value === "string";
  if (bsonType === "bool") return typeof value === "boolean";
  if (bsonType === "date") return (typeof value === "string" && !isNaN(Date.parse(value))) || value instanceof Date;
  if (bsonType === "object") return typeof value === "object" && !Array.isArray(value) && value !== null;
  if (bsonType === "array") return Array.isArray(value);
  return true;
}

// Rekurzivní validace podle schématu
function validateObject(obj, schema, path = "") {
  let errors = [];
  if (schema.bsonType && !checkType(obj, schema.bsonType)) {
    errors.push(`${path}: expected ${schema.bsonType}`);
    return errors;
  }
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in obj)) errors.push(`${path ? path + '.' : ''}${key}: required`);
    }
  }
  if (schema.properties) {
    for (const key in schema.properties) {
      if (obj[key] !== undefined) {
        errors = errors.concat(validateObject(obj[key], schema.properties[key], path ? `${path}.${key}` : key));
      }
    }
  }
  if (schema.items && Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      errors = errors.concat(validateObject(obj[i], schema.items, `${path}[${i}]`));
    }
    if (schema.minItems && obj.length < schema.minItems) {
      errors.push(`${path}: minItems ${schema.minItems}`);
    }
  }
  if (schema.pattern && typeof obj === "string" && !(new RegExp(schema.pattern).test(obj))) {
    errors.push(`${path}: pattern mismatch`);
  }
  if (schema.minimum !== undefined && typeof obj === "number" && obj < schema.minimum) {
    errors.push(`${path}: minimum ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && typeof obj === "number" && obj > schema.maximum) {
    errors.push(`${path}: maximum ${schema.maximum}`);
  }
  return errors;
}

// --- Hlavní validace všech souborů v /dataset ---
async function main() {
  const datasetDir = path.resolve(__dirname, "../dataset");
  if (!fs.existsSync(datasetDir)) {
    console.error("❌ Složka /dataset neexistuje!");
    process.exit(2);
  }
  const files = fs.readdirSync(datasetDir).filter(f => f.endsWith(".json"));
  let allOk = true;

  for (const file of files) {
    const collection = file.replace(/\.json$/, "");
    const schema = schemas[collection];
    if (!schema) {
      console.log(`⚠️  Přeskakuji ${file} (neznámé schéma)`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(datasetDir, file), "utf8"));
    } catch (e) {
      console.log(`❌ ${file}: nelze načíst nebo parsovat JSON`);
      allOk = false;
      continue;
    }
    const docs = Array.isArray(data) ? data : [data];
    let fileOk = true;
    docs.forEach((doc, idx) => {
      const errors = validateObject(doc, schema, "");
      if (errors.length > 0) {
        fileOk = false;
        allOk = false;
        console.log(`❌ ${file} [záznam ${idx}]:`, errors);
      }
    });
    if (fileOk) {
      console.log(`✅ ${file}: validní`);
    }
  }
  if (allOk) {
    console.log("🎉 Všechny soubory jsou validní podle schémat.");
  } else {
    console.log("❗ Některé soubory nejsou validní.");
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(2);
  });
}
