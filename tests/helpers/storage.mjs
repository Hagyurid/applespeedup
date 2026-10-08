import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export class D1TestDatabase {
  constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../../sites/schema.sql',import.meta.url),'utf8'));}
  prepare(sql){return {bind:(...args)=>({
    first:async()=>this.db.prepare(sql).get(...args)||null,
    all:async()=>({results:this.db.prepare(sql).all(...args)}),
    run:async()=>({meta:{changes:Number(this.db.prepare(sql).run(...args).changes)}})
  })};}
  async batch(items){this.db.exec('BEGIN');try{const out=[];for(const i of items)out.push(await i.run());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
export class R2TestBucket {
  constructor(){this.map=new Map();}
  async put(key,bytes,opts){this.map.set(key,{bytes:new Uint8Array(bytes),opts});}
  async get(key){const obj=this.map.get(key);return obj?{body:obj.bytes}:null;}
  async delete(key){this.map.delete(key);}
}
