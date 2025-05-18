// Switch to the correct database
// db = db.getSiblingDB('ecommerce'); // Předpokládáme, že jsme již v kontextu databáze 'ecommerce'

// --- Důležitá poznámka k indexům ---
// Původní zadání indexu: db.order_items.createIndex({ order_id: 1 }, { unique: true });
// Tento index by znamenal, že každá objednávka (order_id) může mít pouze jednu položku v kolekci order_items.
// To je v rozporu s běžnou strukturou e-commerce dat, kde objednávka může obsahovat více položek.
// Příklad dat z Python kódu ("00010242fe8c5a6d1ba2dd792cb16214",1,...) naznačuje, že 'order_item_id' rozlišuje položky v rámci jedné objednávky.
// Pro účely následujících dotazů předpokládám, že buď tento unikátní index na 'order_id' v 'order_items' neexistuje,
// nebo byl opraven na např. db.order_items.createIndex({ order_id: 1, order_item_id: 1 }, { unique: true });
// aby umožnil více položek na objednávku. Následující dotazy jsou psány s tímto předpokladem.
// Pokud by původní unikátní index na order_id v order_items byl striktně vynucen, mnoho dotazů by selhalo nebo vracelo nesmyslné výsledky.

// --- Kategorie 1: Komplexní Vytěžování a Analýza Dat (Agregace, Lookup, Spojení) ---

// 1. Celkové tržby podle kategorie produktů, seřazené od nejvyšší po nejnižší
// # popis dotazu: Tento dotaz spojuje kolekce 'order_items' a 'products', aby zjistil kategorii každého prodaného produktu. Poté групиruje data podle kategorie produktu a sumíruje cenu všech položek v dané kategorii, aby získal celkové tržby. Výsledky jsou seřazeny sestupně podle celkových tržeb.
db.order_items.aggregate([
  {
    $lookup: {
      from: "products",
      localField: "product_id",
      foreignField: "product_id",
      as: "product_info"
    }
  },
  // $lookup: Spojí dokumenty z 'order_items' s dokumenty z 'products' na základě shody 'product_id'.
  // Výsledek spojení pro každý 'order_item' je uložen jako pole 'product_info'.
  {
    $unwind: "$product_info"
  },
  // $unwind: "Rozbalí" pole 'product_info'. Pokud 'product_info' obsahuje jeden dokument (což by mělo být, protože product_id je unikátní v products),
  // vytvoří pro každý 'order_item' nový dokument s obsahem 'product_info' jako kořenovými poli.
  {
    $group: {
      _id: "$product_info.product_category_name",
      total_revenue: { $sum: "$price" }
    }
  },
  // $group: Seskupí dokumenty podle 'product_info.product_category_name'.
  // Pro každou kategorii vypočítá 'total_revenue' jako součet 'price' všech položek v této kategorii.
  {
    $sort: { total_revenue: -1 }
  },
  // $sort: Seřadí výsledné skupiny sestupně (-1) podle 'total_revenue'.
  {
    $project: {
      _id: 0,
      category: "$_id",
      revenue: "$total_revenue"
    }
  }
  // $project: Přeformátuje výstup. Přejmenuje '_id' na 'category' a 'total_revenue' na 'revenue'. '_id: 0' skryje původní MongoDB '_id'.
]);

// 2. Průměrná hodnota objednávky a počet objednávek pro každý stav objednávky ('order_status')
// # popis dotazu: Tento dotaz nejprve spojí 'orders' s 'order_items' aby získal ceny položek pro každou objednávku. Poté seskupí položky podle 'order_id' a vypočítá celkovou hodnotu každé objednávky. Následně tyto hodnoty objednávek seskupí podle 'order_status' a vypočítá průměrnou hodnotu a počet objednávek pro každý status.
db.orders.aggregate([
  {
    $lookup: {
      from: "order_items",
      localField: "order_id",
      foreignField: "order_id",
      as: "items"
    }
  },
  // $lookup: Spojí objednávky s jejich položkami.
  {
    $unwind: "$items" // Rozbalíme položky, abychom mohli sčítat jejich ceny. Pokud by objednávka neměla položky, byla by vyřazena.
                     // Pro zachování objednávek bez položek: { $unwind: { path: "$items", preserveNullAndEmptyArrays: true } }
  },
  // $unwind: Vytvoří samostatný dokument pro každou položku v objednávce.
  {
    $group: {
      _id: { order_id: "$order_id", status: "$order_status" }, // Seskupíme nejprve podle order_id a statusu
      order_total_value: { $sum: "$items.price" } // Součet cen všech položek v dané objednávce
    }
  },
  // $group (první): Seskupí položky podle 'order_id' a 'status', aby se vypočítala celková hodnota každé objednávky ('order_total_value').
  {
    $group: {
      _id: "$_id.status", // Nyní seskupíme podle statusu
      average_order_value: { $avg: "$order_total_value" },
      number_of_orders: { $sum: 1 } // Každý dokument v této fázi reprezentuje jednu unikátní objednávku (díky předchozímu group)
    }
  },
  // $group (druhý): Seskupí objednávky podle 'statusu'.
  // Vypočítá 'average_order_value' jako průměr 'order_total_value' pro daný status.
  // Vypočítá 'number_of_orders' jako počet objednávek v daném statusu.
  {
    $sort: { number_of_orders: -1 }
  },
  // $sort: Seřadí výsledky podle počtu objednávek sestupně.
  {
    $project: {
      _id: 0,
      order_status: "$_id",
      avg_value: { $round: ["$average_order_value", 2] }, // Zaokrouhlení na 2 desetinná místa
      order_count: "$number_of_orders"
    }
  }
  // $project: Přeformátuje výstup, přejmenuje pole a zaokrouhlí průměrnou hodnotu.
]);

// 3. Top 5 prodejců podle celkové hodnoty prodaného zboží (bez poštovného)
// # popis dotazu: Tento dotaz vypočítá celkovou hodnotu prodejů pro každého prodejce z kolekce 'order_items'. Následně seřadí prodejce podle jejich celkových tržeb a vrátí prvních 5.
db.order_items.aggregate([
  {
    $group: {
      _id: "$seller_id",
      total_sales_value: { $sum: "$price" }
    }
  },
  // $group: Seskupí položky objednávek podle 'seller_id'.
  // Pro každého prodejce vypočítá 'total_sales_value' jako součet 'price' všech jím prodaných položek.
  {
    $sort: { total_sales_value: -1 }
  },
  // $sort: Seřadí prodejce sestupně podle 'total_sales_value'.
  {
    $limit: 5
  },
  // $limit: Omezí výstup na prvních 5 prodejců.
  {
    $lookup: { // Volitelný krok pro získání více informací o prodejci, pokud by existovala kolekce 'sellers'
      from: "sellers", // Předpokládáme existenci kolekce 'sellers' s polem 'seller_id'
      localField: "_id",
      foreignField: "seller_id",
      as: "seller_details"
    }
  },
  // $lookup: (Ilustrativní) Pokud by existovala kolekce 'sellers', tento krok by k výsledkům připojil detaily o prodejcích.
  // Pro tento příklad předpokládáme, že chceme jen ID prodejce a jeho tržby.
  {
    $project: {
      _id: 0,
      seller_id: "$_id",
      sales_value: "$total_sales_value"
      // seller_name: { $arrayElemAt: ["$seller_details.name", 0] } // Příklad, pokud by 'sellers' existovala
    }
  }
  // $project: Přeformátuje výstup na čitelnější podobu.
]);

// 4. Zákazníci, kteří si objednali produkty z více než 3 různých kategorií, a počet těchto kategorií.
// # popis dotazu: Tento dotaz identifikuje zákazníky, kteří nakoupili produkty z více než 3 unikátních kategorií. Spojí objednávky s položkami a produkty, aby získal kategorie. Poté pro každého zákazníka spočítá počet unikátních kategorií a filtruje ty, kteří mají více než 3.
db.orders.aggregate([
  {
    $lookup: {
      from: "order_items",
      localField: "order_id",
      foreignField: "order_id",
      as: "items"
    }
  },
  // $lookup (orders -> order_items): Spojí objednávky s jejich položkami.
  {
    $unwind: "$items"
  },
  // $unwind: Rozbalí pole 'items'.
  {
    $lookup: {
      from: "products",
      localField: "items.product_id",
      foreignField: "product_id",
      as: "product_detail"
    }
  },
  // $lookup (order_items -> products): Spojí položky s detaily produktů.
  {
    $unwind: "$product_detail"
  },
  // $unwind: Rozbalí pole 'product_detail'.
  {
    $group: {
      _id: "$customer_id",
      distinct_categories: { $addToSet: "$product_detail.product_category_name" }
    }
  },
  // $group: Seskupí podle 'customer_id'. Pro každého zákazníka vytvoří pole 'distinct_categories' obsahující unikátní názvy kategorií produktů, které si objednal.
  // $addToSet: Přidá hodnotu do pole pouze pokud tam ještě není, čímž zajišťuje unikátnost.
  {
    $project: {
      customer_id: "$_id",
      _id: 0,
      categories_purchased: "$distinct_categories",
      number_of_distinct_categories: { $size: "$distinct_categories" }
    }
  },
  // $project: Přeformátuje výstup, vypočítá 'number_of_distinct_categories' jako velikost pole 'distinct_categories'.
  {
    $match: {
      number_of_distinct_categories: { $gt: 3 }
    }
  },
  // $match: Filtruje výsledky tak, aby obsahovaly pouze zákazníky, kteří nakoupili z více než 3 různých kategorií.
  {
    $sort: { number_of_distinct_categories: -1 }
  }
  // $sort: Seřadí zákazníky podle počtu unikátních kategorií sestupně.
]);

// 5. Průměrná doba od schválení objednávky po doručení (ve dnech) podle kategorie produktu pro doručené objednávky
// # popis dotazu: Tento dotaz vypočítá průměrnou dobu doručení (od schválení po skutečné doručení zákazníkovi) pro produkty v jednotlivých kategoriích. Zahrnuje pouze objednávky, které mají status 'delivered' a platná data schválení a doručení.
// # poznámky: Vyžaduje MongoDB 5.0+ pro $dateDiff. Pro starší verze by se musel použít složitější výpočet s $subtract a konverzí na milisekundy/dny.
db.orders.aggregate([
  {
    $match: {
      order_status: "delivered",
      order_approved_at: { $ne: null },
      order_delivered_customer_date: { $ne: null }
    }
  },
  // $match: Filtruje pouze doručené objednávky s platnými daty schválení a doručení.
  {
    $lookup: {
      from: "order_items",
      localField: "order_id",
      foreignField: "order_id",
      as: "items"
    }
  },
  // $lookup (orders -> order_items): Spojí objednávky s jejich položkami.
  {
    $unwind: "$items"
  },
  // $unwind: Rozbalí pole 'items'.
  {
    $lookup: {
      from: "products",
      localField: "items.product_id",
      foreignField: "product_id",
      as: "product_detail"
    }
  },
  // $lookup (order_items -> products): Spojí položky s detaily produktů.
  {
    $unwind: "$product_detail"
  },
  // $unwind: Rozbalí pole 'product_detail'.
  {
    $project: {
      _id: 0,
      product_category: "$product_detail.product_category_name",
      delivery_time_days: { // Výpočet rozdílu v dnech
        $dateDiff: {
          startDate: "$order_approved_at",
          endDate: "$order_delivered_customer_date",
          unit: "day"
        }
      }
    }
  },
  // $project: Vypočítá 'delivery_time_days' jako rozdíl mezi datem doručení a datem schválení v jednotkách dnů.
  // Vybere také kategorii produktu.
  {
    $group: {
      _id: "$product_category",
      average_delivery_days: { $avg: "$delivery_time_days" },
      count: { $sum: 1 } // Počet položek v kategorii s vypočtenou dobou doručení
    }
  },
  // $group: Seskupí podle 'product_category'.
  // Vypočítá 'average_delivery_days' jako průměr 'delivery_time_days' pro každou kategorii.
  // Spočítá počet položek ('count') v každé kategorii.
  {
    $match: {
        average_delivery_days: { $ne: null } // Odstraní kategorie, kde by průměr mohl být null (např. pokud by data byla nekonzistentní)
    }
  },
  // $match: Odfiltruje kategorie, kde by průměrná doba doručení mohla být null.
  {
    $project: {
        category: "$_id",
        avg_delivery_time_days: { $round: ["$average_delivery_days", 1] },
        number_of_items_evaluated: "$count",
        _id: 0
    }
  },
  // $project: Přeformátuje výstup.
  {
    $sort: { avg_delivery_time_days: 1 }
  }
  // $sort: Seřadí kategorie podle průměrné doby doručení vzestupně.
]);

// 6. Produkty s nejvyšším freight_value (poštovným) v poměru k jejich ceně (price), pro produkty s cenou nad 20.
// # popis dotazu: Identifikuje produkty, kde je hodnota poštovného (freight_value) vysoká v porovnání s cenou samotného produktu. Filtruje pouze produkty s cenou vyšší než 20, aby se zabránilo zkreslení u velmi levných položek.
db.order_items.aggregate([
  {
    $match: {
      price: { $gt: 20 } // Zvažujeme pouze produkty s cenou vyšší než 20
    }
  },
  // $match: Filtruje položky, jejichž cena ('price') je větší než 20.
  {
    $addFields: {
      freight_to_price_ratio: {
        $cond: [ // Podmínka pro zamezení dělení nulou, i když price > 20 by to mělo pokrýt
          { $eq: ["$price", 0] },
          null, // Pokud je cena 0, nastavíme poměr na null (nebo jinou vhodnou hodnotu)
          { $divide: ["$freight_value", "$price"] }
        ]
      }
    }
  },
  // $addFields: Přidá nové pole 'freight_to_price_ratio', které je výsledkem dělení 'freight_value' / 'price'.
  // Používá $cond pro případné ošetření dělení nulou, i když předchozí $match by měl $price > 0 zajistit.
  {
    $match: { // Odstraníme položky, kde poměr nemohl být vypočítán (např. $price bylo 0)
        freight_to_price_ratio: { $ne: null }
    }
  },
  // $match: Odstraní položky, kde poměr nemohl být vypočítán.
  {
    $sort: { freight_to_price_ratio: -1 }
  },
  // $sort: Seřadí položky sestupně podle 'freight_to_price_ratio'.
  {
  $limit: 10 // Zobrazíme top 10 produktů s nejvyšším poměrem
  },
  // $limit: Omezí výstup na prvních 10 položek.
  {
    $lookup: { // Přidáme název produktu pro lepší čitelnost
      from: "products",
      localField: "product_id",
      foreignField: "product_id",
      as: "product_info"
    }
  },
  // $lookup: Spojí s kolekcí 'products' pro získání dalších informací o produktu.
  {
    $unwind: { path: "$product_info", preserveNullAndEmptyArrays: true } // Rozbalí, i když produkt nemusí být nalezen
  },
  // $unwind: Rozbalí pole 'product_info'.
  {
    $project: {
      _id: 0,
      product_id: "$product_id",
      product_category: "$product_info.product_category_name", // Zobrazíme kategorii
      price: "$price",
      freight_value: "$freight_value",
      freight_to_price_ratio: { $round: ["$freight_to_price_ratio", 4] } // Zaokrouhlení poměru
    }
  }
  // $project: Přeformátuje výstup, zobrazí ID produktu, jeho kategorii, cenu, poštovné a vypočítaný poměr.
]);

// 7. Měsíční trendy celkových tržeb a počtu objednávek.
// # popis dotazu: Tento dotaz agreguje data o objednávkách podle roku a měsíce jejich vytvoření. Pro každý měsíc vypočítá celkové tržby (součet cen všech položek v objednávkách uskutečněných v daném měsíci) a celkový počet unikátních objednávek.
// # poznámky: Pro výpočet tržeb je nutné spojit 'orders' s 'order_items'.
db.orders.aggregate([
  {
    $match: { // Ujistíme se, že datum nákupu existuje
      order_purchase_timestamp: { $ne: null }
    }
  },
  // $match: Filtruje objednávky, které mají platné 'order_purchase_timestamp'.
  {
    $lookup: {
      from: "order_items",
      localField: "order_id",
      foreignField: "order_id",
      as: "items"
    }
  },
  // $lookup: Spojí objednávky s jejich položkami pro přístup k cenám.
  {
    $project: {
      year_month: { // Vytvoříme řetězec ROK-MĚSÍC pro seskupování
        $dateToString: { format: "%Y-%m", date: "$order_purchase_timestamp" }
      },
      order_id: "$order_id", // Potřebujeme order_id pro další seskupení pro unikátní objednávky
      items_price: "$items.price" // Pole cen položek v objednávce
    }
  },
  // $project: Extrahuje rok a měsíc z 'order_purchase_timestamp' a vytvoří pole 'year_month'.
  // Také promítne 'order_id' a ceny položek ('items_price').
  {
    $unwind: "$items_price" // Rozbalíme ceny položek, abychom je mohli sčítat
  },
  // $unwind: Pokud má objednávka více položek, vytvoří pro každou položku samostatný dokument, aby se ceny mohly sčítat.
  // Objednávky bez položek budou tímto krokem vyřazeny. Pokud by i ty měly být započítány (s tržbou 0),
  // bylo by nutné upravit logiku (např. preserveNullAndEmptyArrays a následné ošetření).
  {
    $group: { // Seskupíme nejprve podle order_id v rámci měsíce, abychom získali celkovou hodnotu objednávky
      _id: {
        year_month: "$year_month",
        order_id: "$order_id"
      },
      monthly_order_value: { $sum: "$items_price" }
    }
  },
  // $group (první): Seskupí položky podle 'year_month' a 'order_id', aby se vypočítala celková hodnota každé objednávky ('monthly_order_value').
  {
    $group: { // Nyní seskupíme podle měsíce pro finální agregaci
      _id: "$_id.year_month",
      total_monthly_revenue: { $sum: "$monthly_order_value" },
      total_monthly_orders: { $sum: 1 } // Každý dokument v této fázi reprezentuje jednu unikátní objednávku
    }
  },
  // $group (druhý): Seskupí podle 'year_month'.
  // 'total_monthly_revenue' je součet 'monthly_order_value' všech objednávek v daném měsíci.
  // 'total_monthly_orders' je počet unikátních objednávek v daném měsíci.
  {
    $sort: { _id: 1 } // Seřadíme chronologicky
  },
  // $sort: Seřadí výsledky vzestupně podle 'year_month'.
  {
    $project: {
        _id: 0,
        month: "$_id",
        revenue: { $round: ["$total_monthly_revenue", 2] },
        number_of_orders: "$total_monthly_orders"
    }
  }
  // $project: Přeformátuje výstup.
]);

// 8. Analýza zpoždění doručení: Srovnání odhadovaného a skutečného data doručení pro "doručené" objednávky.
// # popis dotazu: Tento dotaz identifikuje objednávky se statusem 'delivered' a porovnává jejich 'order_estimated_delivery_date' s 'order_delivered_customer_date'. Vypočítá rozdíl ve dnech a kategorizuje objednávky na doručené včas, brzy, nebo pozdě.
// # poznámky: Vyžaduje MongoDB 5.0+ pro $dateDiff. Pro starší verze by bylo nutné počítat rozdíl manuálně (např. ($subtract fechas) / (1000*60*60*24)).
db.orders.aggregate([
  {
    $match: {
      order_status: "delivered",
      order_estimated_delivery_date: { $ne: null },
      order_delivered_customer_date: { $ne: null }
    }
  },
  // $match: Filtruje pouze doručené objednávky s platnými daty odhadovaného a skutečného doručení.
  {
    $project: {
      order_id: 1,
      estimated_delivery: "$order_estimated_delivery_date",
      actual_delivery: "$order_delivered_customer_date",
      delivery_diff_days: {
        $dateDiff: {
          startDate: "$order_estimated_delivery_date", // Odhadované datum
          endDate: "$order_delivered_customer_date",   // Skutečné datum doručení
          unit: "day"
        }
      }
    }
  },
  // $project: Vypočítá 'delivery_diff_days'.
  // Kladná hodnota znamená, že doručení bylo PO odhadovaném termínu (pozdě).
  // Záporná hodnota znamená, že doručení bylo PŘED odhadovaným termínem (brzy).
  // Nulová hodnota znamená doručení přesně v odhadovaný den.
  {
    $addFields: {
      delivery_performance: {
        $switch: {
          branches: [
            { case: { $lt: ["$delivery_diff_days", 0] }, then: "Delivered Early" },
            { case: { $eq: ["$delivery_diff_days", 0] }, then: "Delivered On Time (Estimate Day)" },
            { case: { $gt: ["$delivery_diff_days", 7] }, then: "Delivered Very Late ( > 7 days)" },
            { case: { $gt: ["$delivery_diff_days", 0] }, then: "Delivered Late (1-7 days)" }
          ],
          default: "Unknown"
        }
      }
    }
  },
  // $addFields: Přidá pole 'delivery_performance' na základě hodnoty 'delivery_diff_days'.
  // $switch: Poskytuje podmínkovou logiku pro určení kategorie doručení.
  {
    $group: {
      _id: "$delivery_performance",
      count: { $sum: 1 },
      average_delay_or_advance_days: { $avg: "$delivery_diff_days" } // Průměrný rozdíl pro každou kategorii
    }
  },
  // $group: Seskupí objednávky podle 'delivery_performance' a spočítá počet objednávek v každé kategorii
  // a průměrný rozdíl dnů pro danou kategorii.
  {
    $project: {
        _id: 0,
        performance_category: "$_id",
        number_of_orders: "$count",
        avg_diff_days: { $round: ["$average_delay_or_advance_days", 2] }
    }
  },
  // $project: Přeformátuje výstup.
  {
    $sort: { number_of_orders: -1 }
  }
  // $sort: Seřadí kategorie podle počtu objednávek sestupně.
]);

// 9. Identifikace produktů, které se často prodávají společně (velmi zjednodušený základ pro market basket analysis)
// # popis dotazu: Tento dotaz najde páry produktů, které byly zakoupeny v rámci stejné objednávky. Spočítá, kolikrát se každá unikátní dvojice produktů objevila společně.
// # poznámky: Tento dotaz je výpočetně náročnější pro velké datasety. Pro skutečnou market basket analysis by byly potřeba sofistikovanější algoritmy a možná jiná datová struktura.
db.order_items.aggregate([
  { // Seskupíme položky podle objednávky a vytvoříme pole product_id
    $group: {
      _id: "$order_id",
      products_in_order: { $addToSet: "$product_id" } // $addToSet zajistí unikátní product_id v rámci objednávky
    }
  },
  // $group: Seskupí položky podle 'order_id' a pro každou objednávku vytvoří pole 'products_in_order' obsahující unikátní ID produktů v této objednávce.
  { // Filtrujeme objednávky, které mají alespoň 2 různé produkty
    $match: {
      "products_in_order.1": { $exists: true } // Zkontroluje, zda pole má alespoň druhý prvek (index 1)
    }
  },
  // $match: Ponechá pouze objednávky, které obsahují alespoň dva různé produkty, protože hledáme páry.
  { // Rozbalíme pole produktů, abychom mohli vytvářet páry
    $unwind: "$products_in_order"
  },
  // $unwind: "Rozmnoží" dokumenty tak, že každý dokument nyní reprezentuje jeden produkt z původního pole 'products_in_order',
  // ale stále si pamatuje původní '_id' (order_id) a celé pole 'products_in_order' (před $unwind).
  // Pro opravdovou tvorbu párů potřebujeme self-join nebo další logiku.
  // Toto je zjednodušení. Správněji:
  // 1. Získat seznam produktů pro každou objednávku.
  // 2. Pro každou objednávku s více než jedním produktem vygenerovat všechny možné páry produktů.
  // 3. Agregovat tyto páry.

  // Opravený přístup pro generování párů:
  {
    $lookup: { // Self-lookup na order_items (nebo spíše na výsledek prvního group)
               // Tento přístup je složitý. Jednodušší je použít $unwind dvakrát a filtrovat.
      from: "order_items", // Znovu se podíváme na položky objednávek
      let: { current_order_id: "$_id", current_product: "$products_in_order" }, // _id je zde order_id, products_in_order je jeden produkt po unwind
      pipeline: [
        { $match: {
            $expr: {
              $and: [
                { $eq: ["$order_id", "$$current_order_id"] }, // Stejná objednávka
                { $ne: ["$product_id", "$$current_product"] }, // Jiný produkt
                { $lt: ["$$current_product", "$product_id"] } // Zajištění unikátních párů (productA, productB) a ne (productB, productA) a ne (productA, productA)
              ]
            }
          }
        },
        { $project: { _id: 0, paired_product_id: "$product_id" } }
      ],
      as: "paired_products"
    }
  },
  // $lookup (s pipeline): Pro každý produkt ('products_in_order' po prvním $unwind) v objednávce ('$_id')
  // najde všechny ostatní produkty ('paired_product_id') ve STEJNÉ objednávce.
  // Podmínka `$lt: ["$$current_product", "$product_id"]` zajišťuje, že každý pár je generován pouze jednou (např. P1-P2, ale ne P2-P1) a zabraňuje párování produktu se sebou samým.
  {
    $unwind: "$paired_products" // Rozbalíme nalezené páry
  },
  // $unwind: Vytvoří samostatný dokument pro každý nalezený pár.
  {
    $group: { // Seskupíme a spočítáme výskyty každého páru
      _id: {
        product1: "$products_in_order", // Původní produkt z prvního unwind
        product2: "$paired_products.paired_product_id" // Spárovaný produkt
      },
      count: { $sum: 1 }
    }
  },
  // $group: Seskupí podle vytvořeného páru produktů ('product1', 'product2').
  // 'count' udává, v kolika objednávkách se tento konkrétní pár produktů objevil společně.
  {
    $sort: { count: -1 }
  },
  // $sort: Seřadí páry podle počtu společných výskytů sestupně.
  {
    $limit: 10 // Zobrazíme top 10 nejčastějších párů
  },
  // $limit: Omezí výstup na prvních 10 nejčastěji společně prodávaných párů.
  {
      $project: {
          _id: 0,
          product_pair: "$_id",
          times_ordered_together: "$count"
      }
  }
  // $project: Přeformátuje výstup.
]);

// 10. Distribuce cen produktů (min, max, avg, medián) v rámci jednotlivých produktových kategorií.
// # popis dotazu: Pro každou produktovou kategorii vypočítá minimální, maximální a průměrnou cenu produktů. Také vypočítá medián ceny, což vyžaduje seřazení cen a výběr prostředního prvku.
// # poznámky: Výpočet mediánu pomocí agregace může být složitější. Pro přesný medián je třeba seřadit všechny ceny v kategorii a vybrat prostřední. $percentile operátor (MongoDB 4.4+) by to zjednodušil. Zde ukážu přístup, který funguje i na starších verzích, i když může být méně performantní pro velké kategorie.
db.products.aggregate([
  {
    $match: { // Zajistíme, že kategorie a cena existují a cena je číslo
        product_category_name: { $ne: null, $ne: "" },
        // 'price' je v order_items, ne v products. Musíme jít přes order_items, nebo předpokládat, že products má také cenu.
        // Pro tento dotaz použijeme ceny z order_items, protože to jsou skutečné prodejní ceny.
        // Takže musíme začít od order_items a spojit s products.
    }
  },
  // Tento dotaz je lépe začít z order_items, pokud chceme analyzovat prodejní ceny.
  // Pokud chceme analyzovat katalogové ceny (a 'products' by je mělo), pak je start z 'products' OK.
  // Předpokládejme, že chceme analyzovat PRODEJNÍ ceny (z 'order_items') podle kategorií (z 'products').

  // Správný začátek pro analýzu PRODEJNÍCH cen:
  { $lookup: { // Přidáme kategorii produktu k položkám objednávky
      from: "products",
      localField: "product_id",
      foreignField: "product_id",
      as: "product_details"
  }},
  { $unwind: "$product_details" },
  { $match: { "product_details.product_category_name": { $ne: null, $ne: "" }, "price": {$type: "number", $gte: 0} }}, // Cena je numerická a nezáporná
  { // Seřadíme ceny v rámci každé kategorie
    $sort: { "product_details.product_category_name": 1, "price": 1 }
  },
  // $sort: Seřadí všechny položky nejprve podle kategorie produktu a poté podle ceny vzestupně.
  { // Seskupíme podle kategorie a shromáždíme všechny ceny do pole
    $group: {
      _id: "$product_details.product_category_name",
      prices: { $push: "$price" }, // Shromáždí všechny ceny pro danou kategorii do pole
      min_price: { $min: "$price" },
      max_price: { $max: "$price" },
      avg_price: { $avg: "$price" },
      count: { $sum: 1 }
    }
  },
  // $group: Seskupí podle kategorie.
  // 'prices': pole všech cen v dané kategorii.
  // 'min_price', 'max_price', 'avg_price': standardní agregační funkce.
  // 'count': počet produktů (položek) v kategorii.
  { // Vypočítáme medián
    $project: {
      category: "$_id",
      min_price: 1,
      max_price: 1,
      avg_price: { $round: ["$avg_price", 2] },
      count: 1,
      median_price: { // Výpočet mediánu
        $let: {
          vars: {
            prices_sorted: "$prices", // ceny jsou již seřazeny z kroku $sort
            count_items: "$count"
          },
          in: {
            $cond: { // Podmínka pro sudý/lichý počet prvků
              if: { $eq: [{ $mod: ["$$count_items", 2] }, 0] }, // Sudý počet
              then: { // Průměr dvou prostředních
                $avg: [
                  { $arrayElemAt: ["$$prices_sorted", { $subtract: [{ $divide: ["$$count_items", 2] }, 1] }] },
                  { $arrayElemAt: ["$$prices_sorted", { $divide: ["$$count_items", 2] }] }
                ]
              },
              else: { // Lichý počet - vezmeme prostřední
                $arrayElemAt: ["$$prices_sorted", { $floor: { $divide: ["$$count_items", 2] } }]
              }
            }
          }
        }
      },
      _id: 0
    }
  },
  // $project: Vypočítá 'median_price'.
  // $let: Definuje proměnné 'prices_sorted' (již seřazené pole cen) a 'count_items'.
  // $cond: Rozlišuje mezi sudým a lichým počtem cen pro výpočet mediánu.
  // $arrayElemAt: Vrací prvek pole na daném indexu.
  // Pro MongoDB 4.4+ by se zde dalo použít $percentile: { p: [0.5], input: "$prices", method: 'approximate' (nebo 'exact')}
  {
    $sort: { category: 1 } // Seřadíme abecedně podle kategorie
  }
  // $sort: Seřadí výsledky podle názvu kategorie.
]);


// --- Kategorie 2: Práce s daty (Insert, Update, Delete, Merge) ---

// 11. Vložení nové objednávky a jejích položek
// # popis dotazu: Tento příklad ukazuje vložení nového dokumentu do kolekce 'orders' a následně vložení souvisejících dokumentů (položek objednávky) do kolekce 'order_items'. MongoDB nepodporuje ACID transakce napříč kolekcemi v základním režimu (mimo replica sety s novějšími verzemi), takže se jedná o dvě oddělené operace.
// # poznámky: `ObjectId()` generuje unikátní ID. V reálné aplikaci by se měla ošetřit konzistence dat (např. pokud vložení položek selže).
// Nejprve vygenerujeme nové ID objednávky
var new_order_id = new ObjectId().toString(); // Nebo použijeme existující formát ID, např. unikátní řetězec
if (db.version() < "3.6") { new_order_id = new ObjectId().valueOf(); } // Pro starší MongoDB

// Pro konzistenci s existujícími daty použijeme podobný formát ID, pokud je to možné,
// nebo si vygenerujeme vlastní unikátní ID. Pro tento příklad použijeme vlastní ID.
var custom_order_id = "new_order_" + Date.now();
var customer_id_example = "customer_" + Math.random().toString(36).substring(2, 10); // Fiktivní customer_id

db.orders.insertOne({
  order_id: custom_order_id,
  customer_id: customer_id_example,
  order_status: "created",
  order_purchase_timestamp: new Date(),
  order_approved_at: null,
  order_delivered_carrier_date: null,
  order_delivered_customer_date: null,
  order_estimated_delivery_date: new Date(new Date().getTime() + (7 * 24 * 60 * 60 * 1000)) // Odhad doručení za 7 dní
});
// db.orders.insertOne: Vloží jeden dokument do kolekce 'orders'.
// Vytvoří novou objednávku se statusem 'created', aktuálním časem nákupu a odhadovaným datem doručení.

db.order_items.insertMany([
  {
    order_id: custom_order_id,
    order_item_id: 1,
    product_id: "4244733e06e7ecb4970a6e2683c13e61", // Příklad existujícího product_id
    seller_id: "48436dade18ac8b2bce089ec2a041202",   // Příklad existujícího seller_id
    shipping_limit_date: new Date(new Date().getTime() + (3 * 24 * 60 * 60 * 1000)), // Limit odeslání za 3 dny
    price: 58.90,
    freight_value: 13.29
  },
  {
    order_id: custom_order_id,
    order_item_id: 2,
    product_id: "1e9e8ef04dbcff4541ed26657ea517e5", // Jiný příklad product_id
    seller_id: "48436dade18ac8b2bce089ec2a041202",
    shipping_limit_date: new Date(new Date().getTime() + (3 * 24 * 60 * 60 * 1000)),
    price: 35.00,
    freight_value: 10.00
  }
]);
// db.order_items.insertMany: Vloží více dokumentů (pole dokumentů) do kolekce 'order_items'.
// Tyto dokumenty představují položky nově vytvořené objednávky. Každá položka má unikátní 'order_item_id' v rámci dané 'order_id'.

// Pro ověření (tento dotaz nevrací data jako hlavní úkol, ale ukazuje výsledek):
db.orders.find({ order_id: custom_order_id });
db.order_items.find({ order_id: custom_order_id });


// 12. Aktualizace statusu objednávky a přidání data schválení a doručení.
// # popis dotazu: Tento dotaz aktualizuje jednu konkrétní objednávku. Mění její 'order_status' na 'delivered' a nastavuje 'order_approved_at' a 'order_delivered_customer_date' na aktuální čas.
// # poznámky: Používá se operátor $set pro modifikaci hodnot polí.
var order_to_update_id = custom_order_id; // Použijeme ID z předchozího příkladu, nebo jiné existující ID
// Pokud custom_order_id není definováno (např. při samostatném spuštění tohoto dotazu), vybereme nějakou objednávku:
if (typeof custom_order_id === 'undefined') {
    var sample_order = db.orders.findOne({ order_status: "created" }); // Najdeme nějakou objednávku k aktualizaci
    if (sample_order) {
        order_to_update_id = sample_order.order_id;
    } else {
        // Vložíme testovací objednávku, pokud žádná 'created' neexistuje
        db.orders.insertOne({order_id: "test_update_order_123", customer_id: "cust123", order_status: "created", order_purchase_timestamp: new Date()});
        order_to_update_id = "test_update_order_123";
    }
}

db.orders.updateOne(
  { order_id: order_to_update_id }, // Podmínka pro výběr dokumentu k aktualizaci
  {
    $set: { // Operátor pro nastavení nových hodnot polí
      order_status: "delivered",
      order_approved_at: new Date(new Date().getTime() - (2 * 24 * 60 * 60 * 1000)), // Schváleno před 2 dny
      order_delivered_customer_date: new Date() // Doručeno nyní
    },
    $currentDate: { // Další možnost jak nastavit aktuální datum
        last_modified: true // Přidá/aktualizuje pole 'last_modified' aktuálním datem
    }
  }
);
// db.orders.updateOne: Aktualizuje jeden dokument, který odpovídá filtru.
// První argument je filtr pro výběr dokumentu (zde podle 'order_id').
// Druhý argument definuje aktualizační operace.
// $set: Nastaví hodnoty uvedených polí. Pokud pole neexistuje, vytvoří ho.
// $currentDate: Nastaví uvedené pole na aktuální datum a čas. 'true' znamená typ Date.

// Pro ověření (vrací aktualizovaná data):
db.orders.find({ order_id: order_to_update_id });

// 13. Zvýšení ceny všech produktů (v order_items) v určité kategorii o 10%.
// # popis dotazu: Tento dotaz nejprve identifikuje všechny product_id patřící do zadané kategorie. Poté v kolekci 'order_items' aktualizuje cenu ($mul) u všech položek, které obsahují tyto produkty.
// # poznámky: Tento typ operace (hromadná změna cen v historických objednávkách) je obvykle nežádoucí. Častěji by se měnila cena v katalogu produktů. Zde je to ukázka $mul a dvoufázové aktualizace. Pro tento příklad budeme aktualizovat ceny v 'order_items' pro produkty dané kategorie, které ještě nebyly "odeslány" (hypotetický scénář).
var target_category = "perfumaria"; // Příklad kategorie
// Najdeme produkty v dané kategorii
var product_ids_in_category = db.products.find(
  { product_category_name: target_category },
  { product_id: 1, _id: 0 } // Projekce pouze product_id
).map(p => p.product_id); // Získáme pole IDček produktů

if (product_ids_in_category.length > 0) {
  db.order_items.updateMany(
    {
      product_id: { $in: product_ids_in_category }, // Položky obsahující produkty z dané kategorie
      // Můžeme přidat další podmínku, např. pouze pro objednávky, které ještě nejsou ve finálním stavu,
      // ale pro jednoduchost příkladu aktualizujeme všechny odpovídající položky.
      // Příklad: shipping_limit_date: { $gte: new Date() } // Pouze pro položky, které ještě nebyly odeslány
    },
    {
      $mul: { price: 1.10 } // Zvýšení ceny o 10% (price = price * 1.10)
    }
  );
  // db.order_items.updateMany: Aktualizuje více dokumentů, které odpovídají filtru.
  // product_id: { $in: product_ids_in_category }: Filtruje položky, jejichž 'product_id' je v seznamu produktů z cílové kategorie.
  // $mul: Násobí hodnotu pole zadaným číslem. Zde 'price' vynásobí 1.10.

  // Pro ověření (vrací některé aktualizované položky, pokud existují):
  db.order_items.find({ product_id: { $in: product_ids_in_category } }).limit(5);
} else {
  print("No products found in category: " + target_category + ". No prices updated in order_items.");
  // Vrátíme prázdný výsledek, aby bylo zřejmé, že se nic neprovedlo.
  db.order_items.find({_id: null}); // Dotaz, který zaručeně nic nevrátí
}


// 14. Smazání "starých" objednávek (např. starších než 5 let a se statusem 'canceled' nebo 'unavailable') a jejich přidružených položek.
# popis dotazu: Tento dotaz nejprve identifikuje a smaže objednávky starší než určený časový limit a mající určitý status. Následně smaže i odpovídající položky z 'order_items'.
# poznámky: Toto je dvoufázová operace. V reálném prostředí by bylo vhodné zvážit archivaci místo tvrdého smazání.
var five_years_ago = new Date();
five_years_ago.setFullYear(five_years_ago.getFullYear() - 5);
var statuses_to_delete = ["canceled", "unavailable"];

// Nejprve najdeme ID objednávek k smazání, abychom mohli smazat i jejich položky
var orders_to_delete_ids = db.orders.find(
  {
    order_purchase_timestamp: { $lt: five_years_ago },
    order_status: { $in: statuses_to_delete }
  },
  { order_id: 1, _id: 0 } // Promítneme pouze order_id
).map(o => o.order_id);

if (orders_to_delete_ids.length > 0) {
  // Smazání položek těchto objednávek
  var items_delete_result = db.order_items.deleteMany({ order_id: { $in: orders_to_delete_ids } });
  // db.order_items.deleteMany: Smaže všechny dokumenty, které odpovídají filtru (položky patřící k vybraným objednávkám).

  // Smazání samotných objednávek
  var orders_delete_result = db.orders.deleteMany({ order_id: { $in: orders_to_delete_ids } });
  // db.orders.deleteMany: Smaže všechny dokumenty (objednávky), které odpovídají původnímu filtru (nebo jen IDčkům).

  print("Deleted " + items_delete_result.deletedCount + " order items.");
  print("Deleted " + orders_delete_result.deletedCount + " orders.");
  // Pro vrácení dat (např. jako potvrzení, že data již neexistují):
  db.orders.find({ order_id: { $in: orders_to_delete_ids } }); // Mělo by vrátit prázdný kurzor
} else {
  print("No old orders matching criteria found for deletion.");
  db.orders.find({_id: null}); // Dotaz, který zaručeně nic nevrátí
}


// 15. Použití $merge k vytvoření/aktualizaci souhrnné kolekce denních tržeb podle kategorie produktu.
# popis dotazu: Tento dotaz agreguje denní tržby podle kategorie produktu a výsledek uloží (nebo aktualizuje, pokud existuje) do nové kolekce 'daily_category_sales_summary'.
# poznámky: $merge je mocný nástroj pro ETL procesy a tvorbu materializovaných pohledů. Vyžaduje MongoDB 4.2+.
// Nejprve provedeme agregaci
var aggregation_pipeline = [
  {
    $match: { order_purchase_timestamp: { $ne: null } } // Jen objednávky s datem
  },
  {
    $lookup: { // Spojení s položkami objednávky
      from: "order_items",
      localField: "order_id",
      foreignField: "order_id",
      as: "items"
    }
  },
  { $unwind: "$items" }, // Rozbalení položek
  {
    $lookup: { // Spojení s produkty pro získání kategorie
      from: "products",
      localField: "items.product_id",
      foreignField: "product_id",
      as: "product_info"
    }
  },
  { $unwind: "$product_info" },
  {
    $project: { // Vytvoření data pro seskupení a cena
      sale_date: { $dateToString: { format: "%Y-%m-%d", date: "$order_purchase_timestamp" } },
      category: "$product_info.product_category_name",
      price: "$items.price"
    }
  },
  {
    $group: { // Seskupení podle data a kategorie, výpočet tržeb a počtu prodaných kusů
      _id: {
        date: "$sale_date",
        category: "$category"
      },
      daily_revenue: { $sum: "$price" },
      items_sold: { $sum: 1 } // Počet prodaných položek
    }
  },
  { // Fáze $merge
    $merge: {
      into: "daily_category_sales_summary", // Cílová kolekce
      on: "_id", // Pole (nebo pole polí) pro shodu dokumentů (primární klíč)
      whenMatched: "replace", // Pokud dokument s daným _id existuje, nahradí se
      whenNotMatched: "insert" // Pokud neexistuje, vloží se nový
    }
  }
  // $merge: Zapíše výsledky agregace do zadané kolekce.
  // into: Název cílové kolekce.
  // on: Určuje pole (nebo pole), podle kterých se hledá shoda mezi výsledky agregace a dokumenty v cílové kolekci. Zde je to celé '_id' (které je objektem {date, category}).
  // whenMatched: Akce při shodě. "replace" nahradí existující dokument. Jiné možnosti: "keepExisting", "merge", "fail", nebo pipeline pro vlastní logiku.
  // whenNotMatched: Akce při neshodě. "insert" vloží nový dokument. Jiné možnosti: "discard", "fail".
];

// Spuštění agregace s $merge
// Tato operace sama o sobě nevrací dokumenty z 'daily_category_sales_summary', ale informace o operaci.
// Pro zobrazení výsledku je třeba dotaz na novou kolekci.
if (db.version() >= "4.2") {
    db.orders.aggregate(aggregation_pipeline);
    // Pro zobrazení dat z nově vytvořené/aktualizované kolekce:
    db.daily_category_sales_summary.find().sort({"_id.date": -1, "_id.category": 1}).limit(10);
} else {
    print("Skipping $merge example, MongoDB version is less than 4.2");
    // Aby dotaz něco vrátil i na starších verzích, můžeme vrátit prázdný výsledek nebo vzorek dat.
    db.products.find({_id: null});
}


// 16. Přidání nového atributu (např. 'is_priority_customer') k objednávkám zákazníků, kteří utratili více než X.
# popis dotazu: Nejprve identifikujeme zákazníky, kteří celkově utratili více než stanovenou částku. Poté aktualizujeme všechny jejich objednávky přidáním nového pole 'is_priority_customer: true'.
# poznámky: Toto je opět vícefázová operace.
var spending_threshold = 500; // Prahová hodnota útraty

// Fáze 1: Identifikace prioritních zákazníků
var priority_customer_ids = db.orders.aggregate([
  {
    $lookup: { // Spojení s položkami pro získání cen
      from: "order_items",
      localField: "order_id",
      foreignField: "order_id",
      as: "items"
    }
  },
  { $unwind: "$items" },
  { // Seskupení podle zákazníka a součet jeho útrat
    $group: {
      _id: "$customer_id",
      total_spent: { $sum: "$items.price" }
    }
  },
  { // Filtrace zákazníků nad prahovou hodnotou
    $match: {
      total_spent: { $gt: spending_threshold }
    }
  },
  { // Projekce pouze ID zákazníků
    $project: { _id: 1 }
  }
]).map(c => c._id); // Získáme pole ID prioritních zákazníků

if (priority_customer_ids.length > 0) {
  // Fáze 2: Aktualizace objednávek těchto zákazníků
  var update_result = db.orders.updateMany(
    { customer_id: { $in: priority_customer_ids } }, // Vybereme objednávky prioritních zákazníků
    { $set: { is_priority_customer_order: true, last_updated_priority_flag: new Date() } } // Přidáme nový atribut
  );
  // db.orders.updateMany: Aktualizuje všechny objednávky, které patří prioritním zákazníkům.
  // $set: Přidá nové pole 'is_priority_customer_order' s hodnotou true a 'last_updated_priority_flag'.

  print("Marked orders for " + update_result.modifiedCount + " (matched: " + update_result.matchedCount + ") orders belonging to " + priority_customer_ids.length + " priority customers.");
  // Pro vrácení dat: Zobrazíme některé z aktualizovaných objednávek
  db.orders.find({ is_priority_customer_order: true }).limit(5);
} else {
  print("No customers found exceeding the spending threshold of " + spending_threshold);
  db.orders.find({_id: null});
}

// --- Kategorie 3: Indexy a Optimalizace Výkonu ---

// 17. Vytvoření složeného indexu pro optimalizaci častého dotazu a jeho použití.
# popis dotazu: Předpokládejme, že často hledáme objednávky podle statusu a seřazujeme je podle data nákupu sestupně. Vytvoříme složený index na `order_status` a `order_purchase_timestamp`. Poté spustíme dotaz, který by z tohoto indexu měl těžit.
# poznámky: Správné indexy jsou klíčové pro výkon databáze.
// Příkaz pro vytvoření indexu (spustí se jednou):
// db.orders.createIndex({ order_status: 1, order_purchase_timestamp: -1 }, { name: "status_timestamp_idx" });
// Popis: Vytvoří složený index s názvem "status_timestamp_idx" na kolekci 'orders'.
// Indexuje pole 'order_status' vzestupně (1) a 'order_purchase_timestamp' sestupně (-1).
// Toto pořadí je vhodné pro dotazy, které filtrují podle 'order_status' a pak řadí podle 'order_purchase_timestamp' (nebo naopak, pokud je řazení v indexu shodné s řazením v dotazu).

// Pokud index neexistuje, vytvoříme ho:
if (!db.orders.getIndexes().some(idx => idx.name === "status_timestamp_idx")) {
    db.orders.createIndex({ order_status: 1, order_purchase_timestamp: -1 }, { name: "status_timestamp_idx" });
    print("Index 'status_timestamp_idx' created.");
} else {
    print("Index 'status_timestamp_idx' already exists.");
}

// Dotaz, který by měl těžit z tohoto indexu:
// Najdeme posledních 10 "doručených" objednávek.
var delivered_orders = db.orders.find(
  { order_status: "delivered" }
).sort(
  { order_purchase_timestamp: -1 }
).limit(10);

// Pro zobrazení dat:
delivered_orders.forEach(printjson);

// Pro ověření použití indexu (spustit v mongo shellu):
// db.orders.find({ order_status: "delivered" }).sort({ order_purchase_timestamp: -1 }).limit(10).explain("executionStats");
// V 'executionStats' by mělo být vidět, že byl použit index "status_timestamp_idx" (v winningPlan.inputStage.indexName).


// 18. Vysvětlení dopadu existujícího indexu na dotaz (použití explain).
# popis dotazu: Použijeme existující index `db.products.createIndex({ product_category_name: 1 })` a ukážeme, jak `explain("executionStats")` pomáhá analyzovat výkon dotazu, který tento index využívá.
# poznámky: `explain()` je základní nástroj pro ladění výkonu dotazů.
// Předpokládáme, že index na product_category_name již existuje (dle úvodního popisu).
// db.products.createIndex({ product_category_name: 1 }, { name: "category_name_idx" }); // Pokud by neexistoval

// Dotaz filtrující podle kategorie:
var target_category_explain = "beleza_saude"; // Příklad kategorie
var query_plan = db.products.find(
  { product_category_name: target_category_explain }
).explain("executionStats");

// `explain("executionStats")` vrátí detailní informace o provedení dotazu.
// Klíčové části výstupu:
// - `executionStats.executionSuccess`: true, pokud dotaz proběhl úspěšně.
// - `executionStats.nReturned`: Počet vrácených dokumentů.
// - `executionStats.executionTimeMillis`: Doba provádění dotazu v milisekundách.
// - `executionStats.totalKeysExamined`: Počet klíčů v indexu, které byly prohledány.
// - `executionStats.totalDocsExamined`: Počet dokumentů, které byly prohledány.
// - `winningPlan.stage`: Popis fáze plánu, která byla vybrána jako optimální.
//   - `IXSCAN` znamená, že byl použit index scan.
//   - `COLLSCAN` znamená, že byl proveden collection scan (prohledání celé kolekce), což je obvykle nežádoucí pro velké kolekce.
// - `winningPlan.inputStage.indexName`: Název použitého indexu.

// Pro tento dotaz očekáváme, že `winningPlan.inputStage.indexName` bude obsahovat název indexu na `product_category_name`.
// `totalKeysExamined` by měl být relativně nízký (blízký `nReturned`, pokud je kategorie selektivní).
// `totalDocsExamined` by měl být také blízký `nReturned`.

// Protože explain() vrací komplexní JSON, pro účely tohoto skriptu vypíšeme jen část nebo potvrzení.
// V reálném shellu by se zobrazil celý JSON.
if (query_plan && query_plan.executionStats && query_plan.winningPlan) {
    print("Query plan for finding products in category '" + target_category_explain + "':");
    print("Execution successful: " + query_plan.executionStats.executionSuccess);
    print("Documents returned: " + query_plan.executionStats.nReturned);
    print("Execution time (ms): " + query_plan.executionStats.executionTimeMillis);
    print("Winning plan stage: " + query_plan.winningPlan.stage);
    if (query_plan.winningPlan.inputStage && query_plan.winningPlan.inputStage.stage === "IXSCAN") {
        print("Index used: " + query_plan.winningPlan.inputStage.indexName);
    } else if (query_plan.winningPlan.stage === "COLLSCAN") {
        print("Warning: Collection scan was performed!");
    }
    // Vrátíme skutečná data pro konzistenci formátu výstupu:
    db.products.find({ product_category_name: target_category_explain }).limit(5);
} else {
    print("Could not retrieve explain plan.");
    db.products.find({_id:null}); // Prázdný výstup
}


// 19. Vytvoření textového indexu a provedení full-text vyhledávání.
# popis dotazu: Vytvoříme textový index na poli `product_category_name` (protože nemáme pole jako `product_name` nebo `product_description` s delším textem). Poté provedeme full-textové vyhledávání pomocí operátoru `$text` a `$search`.
# poznámky: Textové indexy umožňují efektivní vyhledávání slov nebo frází v textových polích. Kolekce může mít pouze jeden textový index.
// Příkaz pro vytvoření textového indexu (spustí se jednou):
// db.products.createIndex({ product_category_name: "text" }, { name: "product_category_text_idx" });
// Popis: Vytvoří textový index s názvem "product_category_text_idx" na poli 'product_category_name'.

// Pokud index neexistuje, vytvoříme ho:
if (!db.products.getIndexes().some(idx => idx.name === "product_category_text_idx")) {
    try {
        db.products.createIndex({ product_category_name: "text" }, { name: "product_category_text_idx", default_language: "portuguese" }); // Předpokládáme portugalštinu pro kategorie
        print("Text index 'product_category_text_idx' created.");
    } catch (e) {
        print("Error creating text index (maybe one already exists with different specs or on different fields): " + e);
    }
} else {
    print("Text index 'product_category_text_idx' already exists.");
}

// Full-text vyhledávání produktů, jejichž kategorie obsahuje slovo "informatica" nebo "acessorios"
// Pro textové vyhledávání je nutné mít alespoň jeden textový index v kolekci.
var search_results = db.products.find(
  { $text: { $search: "informatica acessorios" } }, // Hledá dokumenty obsahující "informatica" NEBO "acessorios"
  { score: { $meta: "textScore" } } // Přidá skóre relevance
).sort(
  { score: { $meta: "textScore" } } // Seřadí podle relevance
).limit(10);

// $text: Operátor pro full-textové vyhledávání.
// $search: Specifikuje hledaný řetězec. Slova jsou oddělena mezerou a standardně se hledá OR.
//   Pro frázi: "$search: \"informatica acessorios\"" (v uvozovkách)
//   Pro AND: "$search: "informatica" "acessorios"" (nefunguje takto přímo, spíše se kombinuje, ale default je OR)
//   Pro vyloučení: "$search: "informatica -tablet"" (informatica, ale ne tablet)
// score: { $meta: "textScore" }: V projekci i v sortu umožňuje pracovat se skóre relevance, které MongoDB přiřadí každému nalezenému dokumentu.

// Zobrazení výsledků:
search_results.forEach(printjson);
// Pokud nebyly nalezeny žádné výsledky, dotaz vrátí prázdný kurzor.
// Pokud textový index neexistuje a je použit $text, dotaz selže.
// Pro tento příklad, pokud nejsou žádné výsledky, vypíšeme prázdný výsledek explicitně, pokud je to nutné.
if (search_results.count() === 0 && db.products.getIndexes().some(idx => idx.key && idx.key.product_category_name === "text")) {
    print("No products found matching the text search criteria for 'informatica acessorios'.");
} else if (!db.products.getIndexes().some(idx => idx.key && idx.key.product_category_name === "text")) {
    print("Text index on product_category_name does not exist or could not be used. Text search might fail or be inefficient.");
    db.products.find({_id:null}); // Prázdný výstup
}


// 20. Použití $hint k vynucení použití specifického indexu (pro demonstrační/testovací účely).
# popis dotazu: Ukážeme, jak lze pomocí `$hint` specifikovat, který index má MongoDB použít pro dotaz. To je užitečné pro testování výkonu různých indexů nebo v situacích, kdy si myslíme, že optimalizátor nevybral nejlepší index.
# poznámky: Používání `$hint` v produkci by mělo být výjimečné, protože obchází optimalizátor dotazů.
// Předpokládejme, že máme dva indexy, které by mohly být použity pro dotaz na 'product_id':
// 1. Unikátní index na `product_id` (primární klíč kolekce 'products'): { product_id: 1 }
// 2. Hypotetický další index, který také zahrnuje `product_id`, např. { product_category_name: 1, product_id: 1 }
// Pro tento příklad použijeme existující unikátní index na `product_id`.
// Název unikátního indexu na product_id je často "_id_" pokud product_id je _id, nebo "product_id_1" pokud je to samostatné pole s indexem.
// Zkontrolujeme název indexu:
var productIdIndexName = "";
var indexes = db.products.getIndexes();
for (var i = 0; i < indexes.length; i++) {
    if (indexes[i].key && indexes[i].key.product_id === 1 && Object.keys(indexes[i].key).length === 1) {
        productIdIndexName = indexes[i].name;
        break;
    }
}

if (productIdIndexName) {
    print("Using product_id index named: " + productIdIndexName);
    var hinted_product = db.products.find(
      { product_id: "1e9e8ef04dbcff4541ed26657ea517e5" } // Příklad existujícího product_id
    ).hint(
      // productIdIndexName // Použití názvu indexu
      { product_id: 1 }    // Nebo specifikace klíče indexu
    ).limit(1); // Omezíme výsledek pro přehlednost

    // $hint: Přikazuje MongoDB použít specifikovaný index. Argumentem může být název indexu nebo dokument specifikující klíče indexu.
    // Pokud specifikovaný index neexistuje, dotaz selže.

    // Zobrazení výsledku:
    hinted_product.forEach(printjson);

    // Ověření pomocí explain:
    // var explain_hint = db.products.find({ product_id: "1e9e8ef04dbcff4541ed26657ea517e5" }).hint({ product_id: 1 }).explain("executionStats");
    // printjson(explain_hint.winningPlan.inputStage); // Mělo by ukázat použití daného indexu.
} else {
    print("Could not find a suitable index on product_id to demonstrate $hint.");
    db.products.find({_id:null});
}


// 21. Smazání nepotřebného/testovacího indexu.
# popis dotazu: Tento příkaz ukazuje, jak smazat existující index z kolekce.
# poznámky: Mazání indexů by se mělo provádět opatrně, protože může negativně ovlivnit výkon dotazů, které na něj spoléhaly.
// Nejprve vytvoříme testovací index, který následně smažeme.
var temp_index_name = "temp_index_to_delete";
db.products.createIndex({ product_weight_g: 1 }, { name: temp_index_name });
print("Temporary index '" + temp_index_name + "' created on products(product_weight_g).");

// Ověříme, že existuje
var index_exists_before_delete = db.products.getIndexes().some(idx => idx.name === temp_index_name);
print("Index '" + temp_index_name + "' exists: " + index_exists_before_delete);

// Smazání indexu podle názvu
if (index_exists_before_delete) {
    db.products.dropIndex(temp_index_name);
    // db.products.dropIndex: Smaže specifikovaný index. Argumentem může být název indexu nebo dokument specifikující klíče indexu.
    print("Temporary index '" + temp_index_name + "' dropped.");
} else {
    print("Temporary index '" + temp_index_name + "' not found, cannot drop.");
}

// Ověříme, že už neexistuje
var index_exists_after_delete = db.products.getIndexes().some(idx => idx.name === temp_index_name);
print("Index '" + temp_index_name + "' exists after drop: " + index_exists_after_delete);

// Jako výstup vrátíme seznam zbývajících indexů na kolekci 'products', aby bylo vidět, že index byl odstraněn.
db.products.getIndexes().forEach(printjson);


// 22. Získání statistik o využití indexů pro kolekci.
# popis dotazu: Příkaz `$indexStats` (v rámci agregační pipeline) poskytuje statistiky o využití každého indexu v kolekci od posledního restartu `mongod` nebo od vytvoření indexu.
# poznámky: Toto je užitečné pro identifikaci nepoužívaných nebo málo používaných indexů, které by mohly být kandidáty na smazání (protože indexy zabírají místo a zpomalují zápisy). Vyžaduje MongoDB 3.2+.
if (db.version() >= "3.2") {
    var index_stats = db.orders.aggregate([
      { $indexStats: {} } // Prázdný objekt znamená statistiky pro všechny indexy v kolekci
    ]);
    // $indexStats: Agregační fáze, která vrací statistiky o využití indexů.
    // Výstup obsahuje pro každý index:
    // - `name`: Název indexu.
    // - `key`: Klíče indexu.
    // - `host`: Hostitel.
    // - `accesses.ops`: Počet operací, které použily index.
    // - `accesses.since`: Čas, od kterého se sbírají statistiky.

    // Zobrazení statistik:
    index_stats.forEach(printjson);
    if (index_stats.toArray().length === 0) { // .toArray() spotřebuje kurzor
        print("No index stats available or collection/indexes do not exist.");
    }
} else {
    print("Skipping $indexStats example, MongoDB version is less than 3.2");
    // Vrátíme alespoň seznam indexů, když $indexStats není k dispozici
    db.orders.getIndexes().forEach(printjson);
}


// --- Kategorie 4: Práce s Poli a Vnořenými Dokumenty ---
// Stávající schéma je poměrně ploché. Pro demonstraci těchto operací si představíme,
// že bychom chtěli přidat pole 'tags' nebo 'reviews' k produktům.

// 23. Přidání nového tagu (prvku do pole) k produktu.
# popis dotazu: Tento dotaz přidá nový tag do pole 'tags' u specifického produktu. Pokud pole 'tags' neexistuje, vytvoří se. Pokud tag již v poli existuje, $addToSet zabrání duplicitě.
# poznámky: Použijeme operátor $addToSet pro přidání unikátních hodnot do pole.
var product_to_tag_id = "1e9e8ef04dbcff4541ed26657ea517e5"; // Příklad product_id
var new_tag = "popular";

db.products.updateOne(
  { product_id: product_to_tag_id },
  { $addToSet: { tags: new_tag } } // Přidá 'new_tag' do pole 'tags', pokud tam ještě není
);
// db.products.updateOne: Aktualizuje jeden produkt.
// $addToSet: Přidá hodnotu do pole pouze v případě, že tam ještě není. Pokud pole 'tags' neexistuje, vytvoří ho s daným prvkem.

// Přidáme další tag pro demonstraci
db.products.updateOne(
  { product_id: product_to_tag_id },
  { $addToSet: { tags: "promo_verao" } }
);

// Pro ověření (vrátí produkt s novým polem 'tags'):
db.products.find({ product_id: product_to_tag_id });


// 24. Aktualizace konkrétní recenze v poli recenzí produktu (předpokládáme vnořené dokumenty).
# popis dotazu: Předpokládejme, že produkty mají pole 'reviews', kde každá recenze je vnořený dokument (např. { reviewer_id: "xyz", rating: 4, text: "..."}). Tento dotaz aktualizuje text recenze od konkrétního recenzenta.
# poznámky: Použijeme operátor $ (poziční) s `arrayFilters` pro cílenou aktualizaci prvku v poli vnořených dokumentů. `arrayFilters` vyžaduje MongoDB 3.6+.
var product_with_reviews_id = "4244733e06e7ecb4970a6e2683c13e61"; // Příklad product_id

// Nejprve přidáme nějaké recenze pro test (pokud neexistují)
db.products.updateOne(
  { product_id: product_with_reviews_id },
  { $set: { reviews: [
      { review_id: new ObjectId(), user_id: "user123", rating: 5, comment: "Excelente produto!", created_at: new Date() },
      { review_id: new ObjectId(), user_id: "user456", rating: 3, comment: "Bom, mas poderia ser melhor.", created_at: new Date(Date.now() - 86400000) } // Včerejší recenze
    ]}}
);

// Aktualizujeme komentář recenze od 'user123'
if (db.version() >= "3.6") {
    db.products.updateOne(
      { product_id: product_with_reviews_id },
      { $set: { "reviews.$[elem].comment": "Produto realmente incrível, recomendo!" } },
      { arrayFilters: [ { "elem.user_id": "user123" } ] }
    );
    // db.products.updateOne: Aktualizuje jeden produkt.
    // "reviews.$[elem].comment": Cesta k poli, které chceme aktualizovat. `elem` je identifikátor definovaný v `arrayFilters`.
    // arrayFilters: Pole podmínek, které určují, které prvky v poli 'reviews' budou aktualizovány.
    //   `{ "elem.user_id": "user123" }`: Podmínka říká, že `elem` je prvek pole `reviews`, kde `user_id` je "user123".
    // Pro starší verze MongoDB by se musel použít poziční operátor $ (např. "reviews.$.comment")
    // spolu s dotazem, který by identifikoval správný prvek pole v query části, např.:
    // db.products.updateOne(
    //   { product_id: product_with_reviews_id, "reviews.user_id": "user123" },
    //   { $set: { "reviews.$.comment": "Produto realmente incrível, recomendo!" } }
    // );
    // Tento starší přístup aktualizuje pouze PRVNÍ nalezený odpovídající prvek. arrayFilters je flexibilnější.
} else {
    // Použití staršího přístupu pro verze < 3.6
    db.products.updateOne(
      { product_id: product_with_reviews_id, "reviews.user_id": "user123" },
      { $set: { "reviews.$.comment": "Produto realmente incrível, recomendo! (legacy update)" } }
    );
    print("Using legacy positional operator for versions < 3.6.");
}

// Pro ověření (vrátí produkt s aktualizovanou recenzí):
db.products.find({ product_id: product_with_reviews_id });


// 25. Nalezení produktů, které mají alespoň jednu recenzi s hodnocením 5 hvězdiček.
# popis dotazu: Tento dotaz vyhledá produkty, které v poli 'reviews' obsahují alespoň jeden vnořený dokument (recenzi) splňující podmínku (rating == 5).
# poznámky: Použijeme operátor $elemMatch.
// Ujistíme se, že nějaký produkt má 5* recenzi
db.products.updateOne(
  { product_id: "1e9e8ef04dbcff4541ed26657ea517e5" }, // Jiný produkt
  { $set: { reviews: [
      { review_id: new ObjectId(), user_id: "user789", rating: 5, comment: "Amei!", created_at: new Date() }
    ]}}
);

var highly_rated_products = db.products.find({
  reviews: { // Hledáme v poli 'reviews'
    $elemMatch: { // Podmínka, kterou musí splňovat alespoň jeden prvek pole
      rating: 5
      // Můžeme přidat další podmínky, např. rating: 5, user_id: "specific_user"
    }
  }
}).project({product_id: 1, product_category_name:1, reviews: 1, _id:0}).limit(10);
// db.products.find: Vyhledá dokumenty.
// reviews: { $elemMatch: { rating: 5 } }: Podmínka říká, že pole 'reviews' musí obsahovat alespoň jeden prvek (vnořený dokument),
// kde pole 'rating' má hodnotu 5.

// Zobrazení výsledků:
highly_rated_products.forEach(printjson);
if (highly_rated_products.count() === 0) {
    print("No products found with a 5-star review based on current data.");
}


// 26. Odstranění konkrétní recenze (nebo tagu) z produktu.
# popis dotazu: Tento dotaz odstraní specifický prvek z pole. Může to být jednoduchá hodnota (jako tag) nebo vnořený dokument splňující určité podmínky (jako recenze).
# poznámky: Použijeme operátor $pull.
var product_to_modify_id = product_with_reviews_id; // Produkt z příkladu 24
var review_id_to_remove = null;

// Najdeme ID recenze, kterou chceme smazat (např. tu od user456)
var product_doc = db.products.findOne({product_id: product_to_modify_id, "reviews.user_id": "user456"});
if (product_doc && product_doc.reviews) {
    var review_to_remove = product_doc.reviews.find(r => r.user_id === "user456");
    if (review_to_remove) {
        review_id_to_remove = review_to_remove.review_id;
    }
}

if (review_id_to_remove) {
    db.products.updateOne(
      { product_id: product_to_modify_id },
      { $pull: { reviews: { review_id: review_id_to_remove } } } // Odstraní všechny recenze s daným review_id
    );
    // db.products.updateOne: Aktualizuje jeden produkt.
    // $pull: Odstraní z pole 'reviews' všechny prvky (vnořené dokumenty), které odpovídají zadané podmínce.
    //   Zde `reviews: { review_id: review_id_to_remove }` znamená: "odstraň z pole reviews ten dokument, jehož pole review_id má tuto hodnotu".
    print("Review with ID " + review_id_to_remove + " removed from product " + product_to_modify_id);
} else {
    print("Review to remove not found for product " + product_to_modify_id);
}

// Příklad smazání tagu (jednodušší)
db.products.updateOne(
  { product_id: product_to_tag_id }, // Produkt z příkladu 23
  { $pull: { tags: "promo_verao" } } // Odstraní všechny výskyty "promo_verao" z pole 'tags'
);
print("Tag 'promo_verao' removed from product " + product_to_tag_id);

// Pro ověření (vrátí produkty s upravenými poli):
db.products.find({ product_id: { $in: [product_to_modify_id, product_to_tag_id] } });


// --- Kategorie 5: Administrativní Příkazy (Sharding, Replikace - Konceptuální) ---
// Tyto příkazy se typicky spouští v mongo shellu připojeném k `mongos` (pro sharding) nebo k členu replica setu.
// Jejich výstup není datový ve smyslu dokumentů z kolekce, ale stavové informace.

// 27. Povolení shardingu pro databázi a kolekci (příkazy a vysvětlení).
# popis dotazu: Ukazuje příkazy pro povolení shardingu na úrovni databáze a následně pro konkrétní kolekci. Sharding rozděluje data kolekce napříč více servery (shardy).
# poznámky: Tyto příkazy se spouští v `mongo` shellu připojeném k `mongos` routeru. Vyžaduje existující sharded cluster.
// Tento kód je pro ilustraci a v tomto prostředí se nespustí korektně bez sharded clusteru.
// Výstupem by byly potvrzovací zprávy od MongoDB.

// Krok 1: Povolení shardingu pro databázi 'ecommerce'
// sh.enableSharding("ecommerce")
// Popis: Tento příkaz označí databázi 'ecommerce' jako databázi, jejíž kolekce mohou být shardovány.
// Musí být spuštěn před shardováním jakékoliv kolekce v této databázi.
// Výstup: { "ok" : 1, "database" : "ecommerce" } (nebo podobný)

// Krok 2: Shardování kolekce 'orders'
// Pro shardování je nutné vybrat shard klíč. Dobrý shard klíč rovnoměrně distribuuje data a zátěž.
// Např. můžeme shardovat podle 'order_id' (pokud je dostatečně kardinální a ne sekvenční) nebo 'customer_id'.
// Pro 'order_id', pokud jsou to náhodné řetězce, může být hashed sharding dobrou volbou.
// sh.shardCollection("ecommerce.orders", { "order_id": "hashed" })
// Nebo range sharding na základě timestampu (pokud jsou dotazy často časově omezené):
// sh.shardCollection("ecommerce.orders", { "order_purchase_timestamp": 1 })

// Popis: Tento příkaz zahájí proces shardování kolekce 'ecommerce.orders'.
// První argument je plný název kolekce (databáze.kolekce).
// Druhý argument je dokument specifikující shard klíč.
//   `{ "order_id": "hashed" }`: Použije hash hodnoty 'order_id' jako shard klíč. To pomáhá rovnoměrné distribuci dat.
//   `{ "customer_id": 1 }`: Použije hodnotu 'customer_id' pro range sharding. Všechny objednávky jednoho zákazníka by byly na stejném shardu.
// Výstup: { "collectionsharded" : "ecommerce.orders", "ok" : 1 }

// Pro účely vrácení "dat" z tohoto skriptu (jelikož nemůžeme skutečně spustit sharding):
print("Příkazy pro sharding (spouští se v mongos shellu):");
print("1. sh.enableSharding(\"ecommerce\")");
print("2. sh.shardCollection(\"ecommerce.orders\", { \"order_id\": \"hashed\" }) // Nebo jiný shard klíč");
// Vrátíme fiktivní stav, jak by mohl vypadat po shardování (velmi zjednodušeně)
db.adminCommand({getShardMap: 1}); // Tento příkaz neexistuje, je to ilustrace. Reálně `sh.status()`


// 28. Získání stavu replikačního setu.
# popis dotazu: Příkaz `rs.status()` vrací detailní informace o stavu replikačního setu, včetně stavu jednotlivých členů, jejich rolí (PRIMARY, SECONDARY), a synchronizačního zpoždění.
# poznámky: Tento příkaz se spouští v `mongo` shellu připojeném k libovolnému členu replikačního setu.
// Tento kód je pro ilustraci. V tomto prostředí se nespustí korektně bez replikačního setu.
// Výstupem by byl velký JSON dokument.

// rs.status()
// Popis: Vrací dokument se stavem replikačního setu.
// Klíčové informace v odpovědi:
// - `set`: Název replikačního setu.
// - `date`: Aktuální čas.
// - `myState`: Stav členu, na kterém byl příkaz spuštěn (1=PRIMARY, 2=SECONDARY, atd.).
// - `term`: Číslo volebního období.
// - `members`: Pole dokumentů, každý popisující jednoho člena replikačního setu:
//   - `_id`: ID člena.
//   - `name`: Adresa člena (host:port).
//   - `health`: Zdraví člena (1=OK).
//   - `stateStr`: Textový popis stavu (PRIMARY, SECONDARY, ARBITER, atd.).
//   - `optimeDate`: Čas poslední operace aplikované na tohoto člena.
//   - `lag`: Odhadované zpoždění oproti primárnímu (pro sekundární členy).

// Pro účely vrácení "dat" z tohoto skriptu:
print("Příkaz pro zjištění stavu replikačního setu (spouští se v shellu člena RS):");
print("rs.status()");
// Vrátíme fiktivní zjednodušený stav (v reálu je mnohem podrobnější)
var faked_rs_status = {
    "set": "myReplicaSet",
    "date": new Date(),
    "myState": 1,
    "term": NumberLong(5),
    "heartbeatIntervalMillis" : NumberLong(2000),
    "members": [
        { "_id": 0, "name": "mongo1.example.com:27017", "health": 1, "stateStr": "PRIMARY", "optimeDate": new Date() },
        { "_id": 1, "name": "mongo2.example.com:27017", "health": 1, "stateStr": "SECONDARY", "optimeDate": new Date(), "lag" : NumberLong(0) },
        { "_id": 2, "name": "mongo3.example.com:27017", "health": 1, "stateStr": "ARBITER", "optimeDate": new Date() }
    ],
    "ok": 1
};
printjson(faked_rs_status);


// 29. Získání informací o databázi a kolekcích.
# popis dotazu: Příkazy `db.stats()` a `db.collection.stats()` poskytují statistiky o velikosti databáze a jednotlivých kolekcí, počtu dokumentů, velikosti indexů atd.
# poznámky: Užitečné pro monitorování využití diskového prostoru a růstu dat.
print("Statistiky pro databázi 'ecommerce':");
var db_stats = db.stats();
// db.stats(): Vrací statistiky pro aktuální databázi.
// Obsahuje např.:
// - `db`: Název databáze.
// - `collections`: Počet kolekcí.
// - `objects`: Celkový počet dokumentů ve všech kolekcích.
// - `avgObjSize`: Průměrná velikost dokumentu.
// - `dataSize`: Celková velikost dat (bez indexů).
// - `storageSize`: Celková velikost alokovaná na disku pro data.
// - `indexes`: Počet indexů.
// - `indexSize`: Celková velikost indexů.
printjson(db_stats);

print("\nStatistiky pro kolekci 'orders':");
var orders_stats = db.orders.stats();
// db.collection.stats(): Vrací statistiky pro konkrétní kolekci.
// Obsahuje např.:
// - `ns`: Namespace kolekce (databáze.kolekce).
// - `count`: Počet dokumentů v kolekci.
// - `size`: Velikost dat v kolekci.
// - `avgObjSize`: Průměrná velikost dokumentu v kolekci.
// - `storageSize`: Velikost alokovaná na disku pro kolekci.
// - `nindexes`: Počet indexů na kolekci.
// - `totalIndexSize`: Celková velikost všech indexů na kolekci.
// - `indexSizes`: Velikosti jednotlivých indexů.
printjson(orders_stats);


// 30. Konfigurace: Získání nebo nastavení úrovně logování (profiler).
# popis dotazu: Databázový profiler zaznamenává informace o pomalých dotazech nebo všech operacích. Tento příklad ukazuje, jak zjistit aktuální úroveň profilování a jak ji případně nastavit.
# poznámky: Profiler je užitečný nástroj pro diagnostiku výkonnostních problémů. Jeho zapnutí na vysokou úroveň v produkci může mít dopad na výkon.
// Zjištění aktuální úrovně profilování
print("Aktuální úroveň profilování pro databázi 'ecommerce':");
var profiling_status = db.getProfilingStatus();
// db.getProfilingStatus(): Vrací dokument s aktuálním stavem profilování.
// - `was`: Úroveň profilování (0=vypnuto, 1=logovat pomalé operace, 2=logovat všechny operace).
// - `slowms`: Prahová hodnota v milisekundách pro "pomalé" operace (pokud was=1).
printjson(profiling_status);

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