import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

function snapshot(path){
  const database=new DatabaseSync(path,{readOnly:true});
  const integrity=database.prepare("PRAGMA integrity_check").get()?.integrity_check;
  const tableNames=database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>String(row.name));
  const rowCounts=Object.fromEntries(tableNames.map(name=>[name,Number(database.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"','""')}"`).get()?.count||0)]));
  const migration=database.prepare("SELECT id,name FROM d1_migrations ORDER BY id DESC LIMIT 1").get()||null;
  database.close();
  return {path,integrity,sha256:createHash("sha256").update(readFileSync(path)).digest("hex"),tableCount:tableNames.length,rowCounts,migration};
}

const [sourcePath,targetPath]=process.argv.slice(2);
if(!sourcePath)throw new Error("Usage: node reconcile-payroll-db.mjs SOURCE [TARGET]");
const source=snapshot(sourcePath);
const result={source};
if(targetPath){
  const target=snapshot(targetPath);
  result.target=target;
  result.matches=source.integrity==="ok"&&target.integrity==="ok"&&source.sha256===target.sha256&&JSON.stringify(source.rowCounts)===JSON.stringify(target.rowCounts);
  if(!result.matches){console.error(JSON.stringify(result,null,2));process.exitCode=1;}
}
console.log(JSON.stringify(result,null,2));
