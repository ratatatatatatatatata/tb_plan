import {DatabaseSync} from 'node:sqlite';
export class LocalD1 {
  constructor(){this.sqlite=new DatabaseSync(':memory:');}
  exec(sql){this.sqlite.exec(sql);}
  prepare(sql){const db=this;return {args:[],sql,bind(...args){this.args=args;return this;},
    async first(){return db.sqlite.prepare(sql).get(...this.args)||null;},
    async all(){return {success:true,results:db.sqlite.prepare(sql).all(...this.args)};},
    async run(){const meta=db.sqlite.prepare(sql).run(...this.args);return {success:true,meta:{changes:Number(meta.changes)},results:[]};}};}
  async batch(statements){this.sqlite.exec('BEGIN');try{const results=[];for(const statement of statements){const p=this.sqlite.prepare(statement.sql);
    if(p.columns().length)results.push({success:true,results:p.all(...statement.args)});else{const r=p.run(...statement.args);results.push({success:true,results:[],meta:{changes:Number(r.changes)}});}}
    this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
  close(){this.sqlite.close();}
}
