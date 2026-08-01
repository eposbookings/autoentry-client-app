import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath=resolve(process.env.PAYFLOW_LOCAL_DB||"./data/payroll.sqlite");
mkdirSync(dirname(databasePath),{recursive:true});
const database=new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys = ON");
database.exec("PRAGMA busy_timeout = 5000");
database.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
const applied=new Set(database.prepare("SELECT name FROM d1_migrations").all().map(row=>String(row.name)));
const migrationDirectory=resolve("drizzle");
const migrations=readdirSync(migrationDirectory).filter(name=>/^\d+_.+\.sql$/.test(name)).sort();
for(const name of migrations){
  if(applied.has(name))continue;
  const sql=readFileSync(resolve(migrationDirectory,name),"utf8");
  database.exec("BEGIN IMMEDIATE");
  try{
    database.exec(sql);
    database.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
    database.exec("COMMIT");
    console.log(`Applied payroll migration ${name}`);
  }catch(error){
    database.exec("ROLLBACK");
    throw error;
  }
}
const integrity=database.prepare("PRAGMA integrity_check").get();
if(integrity?.integrity_check!=="ok")throw new Error(`Payroll database integrity check failed: ${integrity?.integrity_check||"unknown"}`);
database.close();
