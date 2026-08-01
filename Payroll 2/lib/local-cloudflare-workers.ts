import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { resolve } from "node:path";

const defaultDatabasePath=resolve(process.cwd(),".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite");
const database=new DatabaseSync(process.env.PAYFLOW_LOCAL_DB||defaultDatabasePath);
database.exec("PRAGMA foreign_keys = ON");
database.exec("PRAGMA busy_timeout = 5000");

function normalise(values:unknown[]):SQLInputValue[]{
  return values.map(value=>typeof value==="boolean"?(value?1:0):value as SQLInputValue);
}

class LocalD1Statement{
  readonly query:string;
  readonly params:SQLInputValue[];
  constructor(query:string,params:SQLInputValue[]=[]){this.query=query;this.params=params;}
  bind(...values:unknown[]){return new LocalD1Statement(this.query,normalise(values));}
  private meta(changes=0,lastRowId:bigint|number=0){return{duration:0,changes,last_row_id:Number(lastRowId),rows_read:0,rows_written:changes,size_after:0};}
  async all(){const statement=database.prepare(this.query),results=statement.all(...this.params) as Record<string,unknown>[];return{success:true,results,meta:this.meta()};}
  async first(column?:string){const row=(await this.all()).results[0];return column?row?.[column]??null:row??null;}
  async raw(){const statement=database.prepare(this.query);statement.setReturnArrays(true);return statement.all(...this.params) as unknown[][];}
  async run(){
    if(/^\s*(select|pragma|with)\b/i.test(this.query)||/\breturning\b/i.test(this.query))return this.all();
    const result=database.prepare(this.query).run(...this.params);
    return{success:true,results:[],meta:this.meta(Number(result.changes),result.lastInsertRowid)};
  }
}

class LocalD1Database{
  prepare(query:string){return new LocalD1Statement(query);}
  async batch(statements:LocalD1Statement[]){
    database.exec("BEGIN");
    try{const results=[];for(const statement of statements)results.push(await statement.run());database.exec("COMMIT");return results;}
    catch(error){database.exec("ROLLBACK");throw error;}
  }
  async exec(query:string){database.exec(query);return{count:query.split(";").filter(Boolean).length,duration:0};}
}

export const env={
  DB:new LocalD1Database(),
};
