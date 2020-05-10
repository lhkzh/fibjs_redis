/// <reference types="@fibjs/types" />

import net=require("net");
import io=require("io");
import Url=require("url");
import QueryString = require('querystring');
import coroutine=require("coroutine");
import util=require('util');
export interface RedisConfig {
    host:string,port:number,auth?:string, db:number, timeout:number,autoReconnect:boolean
}
/**
 * Redis client
 * "redis://127.0.0.1:6379"
 * "redis://authpwd@127.0.0.1:6379?db=1&prefix=XX:"
 * "redis://127.0.0.1:6379?db=1&prefix=XX:&auth=authpwd"
 */
export class Redis {
    public waitReconnect=true;//发送指令时,如果在重连中是否等待重连
    protected _prefix:{str:string,buf:Class_Buffer}={str:"",buf:null};
    private _opts:RedisConfig;
    private _sender:Class_Fiber;
    private _reader:RespReader;
    private _socket:Class_Socket;
    private _onOpen:Class_Event;
    private _connected:boolean;
    private _killed:boolean;
    private _backs:Array<OptEvent>;//request_response_fn
    private _mult_backs:Array<Function>;//mult_exec_convert
    private _subFn:{[index:string]:Array<(d:Class_Buffer, chan?:string)=>void>};//subscribe
    private _psubFn:{[index:string]:Array<(d:Class_Buffer, chan?:string)=>void>};//psubscribe
    private _sub_backs:Array<OptEvent>;//subscribe_cmd_handler
    private _sendBufs:Class_Buffer[];
    private _sendEvt:Class_Event;
    constructor(conf:RedisConfig|string="redis://127.0.0.1:6379"){
        if(conf===null)return;
        this._opts=util.isString(conf)?uriToConfig(conf+""):<RedisConfig>conf;
        this._onOpen = new coroutine.Event(false);
        this._sendBufs=[];
        this._sendEvt=new coroutine.Event(false);
        this._do_conn();
    }
    public get prefix():string{
        return this._prefix.str;
    }
    public set prefix(s:string){
        if(s==null||s.length==0){
            this._prefix={str:"",buf:null};
        }else{
            this._prefix={str:s,buf:Buffer.from(s)};
        }
    }
    private _do_conn(){
        let opts = this._opts;
        var sock=new net.Socket();
        sock.timeout=opts.timeout;
        sock.connect(opts.host, opts.port);
        var buf=new io.BufferedStream(sock);
        buf.EOL="\r\n";
        opts.auth && this._pre_command(sock,buf,'auth',opts.auth);
        opts.db>0 && this._pre_command(sock,buf,'select',opts.db);
        this._socket=sock;
        this._backs=[];
        this._connected=true;
        this._pre_Fibers();
        this.pre_sub_onConnect();
        this._onOpen.set();
        this._reader.run();
    }
    private _pre_Fibers(){
        let T=this;
        T._socket.timeout=-1;
        T._sender = coroutine.start(function(){
            let sock=T._socket, buf:Class_Buffer;
            while(T._socket===sock && T._connected){
                if(T._sendBufs.length>0){
                    buf = T._sendBufs.length>1?Buffer.concat(T._sendBufs):T._sendBufs[0];
                    T._sendBufs.length=0;
                    try{
                        sock.send(buf);
                    }catch (e) {
                        console.error("Redis|on_send",e);
                        coroutine.start(()=>{
                            T._on_err(e, true);
                        });
                        break;
                    }
                }else{
                    T._sendEvt.clear();
                    T._sendEvt.wait();
                }
            }
        });
        T._reader = new RespReader(T._socket, {
            check:(sock:Class_Socket)=>{
                return T._socket===sock && T._connected
            },
            onClose:T._on_lost.bind(T),
            onErr:T._on_err.bind(T),
            replyError:err=>{
                try{
                    if (T._sub_backs) {
                        T._sub_backs.shift().fail(new RedisError(err));
                    }else{
                        T._backs.shift().fail(new RedisError(err));
                    }
                }catch(exx){
                    // console.error("--->>>", (reply||"null").toString(),exx)
                    console.error("Redis|on_reply",exx);
                }
            },
            replyData:reply=>{
                try{
                    if(T._sub_backs){
                        T._on_subReply(reply);
                    }else{
                        T._backs.shift().then(reply);
                    }
                }catch(exx){
                    // console.error("--->>>", (reply||"null").toString(),exx)
                    console.error("Redis|on_reply",exx);
                }
            }
        });
    }
    private _pre_command(sock:Class_Socket,buf:Class_BufferedStream, ...args){
        // buf.write(commandToResp(args));
        buf.write(encodeCommand(args));
        var str=buf.readLine();
        if(str==null){
            sock.close();
            throw new RedisError("io-err");
        }
        if(str.indexOf("invalid")>0){
            sock.close();
            throw new RedisError("ERR invalid password");
        }
    }
    private _on_lost(){
        this._on_err(new Error("io_error"), true);
    }
    private _on_err(e, deadErr?:boolean){
        if(this._socket==null){
            return;
        }
        console.error("Redis|_on_err%s",this._opts.host+":"+this._opts.port, e);
        this._connected=false;
        if(this._reader){
            this._reader.kill();
        }
        try{
            this._socket.close();
        }catch (e) {
        }
        this._onOpen.clear();
        this._sendBufs.length=0;
        this._sendEvt.set();
        var backs=this._backs;this._backs=[];
        backs.forEach(operation=>{
            operation.fail(e);
        });
        backs=this._sub_backs;this._sub_backs=null;
        if(backs){
            backs.forEach(operation=>{
                operation.fail(e);
            });
        }
        this._mult_backs=null;
        if(this._opts.autoReconnect && !this._killed){
            var i=0;
            while(!this._connected && !this._killed){
                try{
                    this._do_conn();
                    break;
                }catch (e) {
                    console.error("Redis|%s",this._opts.host+":"+this._opts.port, e);
                    try{
                        this._socket.close();
                    }catch (e) {
                    }
                }
                i++;
                coroutine.sleep(Math.min(i*5,500));
            }
        }
    }
    public close(){
        this._killed=true;
        this._connected=false;
        var sock=this._socket;
        this._socket=null;
        this._sendEvt.set();
        this._reader&&this._reader.kill();
        try{
            sock.close();
        }catch (e) {
        }
        var backs=this._backs;this._backs=[];
        var e=new Error("io_close");
        backs.forEach(operation=>{
            operation.fail(e);
        });
    }
    protected isInPipeline(){
        return false;
    }
    protected beforeSend(){
        if(this._killed){
            throw new RedisError("io_had_closed");
        }
        if(!this._connected && this._opts.autoReconnect){
            if(this.waitReconnect){
                this._onOpen.wait();//等待重连
            }
        }
        if(!this._socket || !this._connected){
            throw new RedisError("io_error");
        }
    }
    protected _temp_cmds:Class_Buffer[]=[];
    protected send(...args){
        this._temp_cmds.push(encodeCommand(args));
        return this;
    }
    protected wait(convert?){
        var backs=this._backs;
        if(this._sub_backs){
            backs=this._sub_backs;
        }else if(this._mult_backs){
            this._mult_backs.push(convert);
            convert=castStr;
        }
        this.beforeSend();
        var evt=new OptEvent();
        backs.push(evt);
        this._sendBufs.push(...this._temp_cmds);
        this._sendEvt.set();
        this._temp_cmds.length=0;
        return evt.wait(convert);
    }
    public rawCommand(cmd:string,...args):any{
        // console.log("...>",cmd,...args);
        return this.send(...arguments).wait();
    }
    public ping():string{
        return this.send(CmdPing).wait(castStr);
    }
    public quit():boolean{
        var t=this.send(CmdQuit);
        t._killed=true;
        try{
            t.wait(castBool);
        }catch (e) {
        }finally {
            t.close();
        }
        return true;
    }
    public echo(s:string):string{
        return this.send(CmdEcho, s).wait(castStr);
    }
    public swapdb(a:number, b:number):boolean{
        return this.send(CmdSwapdb, a, b).wait(castBool);
    }
    public select(db:number):boolean{
        return this.send(CmdSelect, db).wait(castBool);
    }
    public info(option?:string):string{
        var args = option&&option.length>0 ? [CmdInfo, option]:[CmdInfo];
        return this.send(...args).wait(castStr);
    }
    public client(subCommand:string, ...args):string{
        return this.send(CmdClient, subCommand, ...args).wait(castStr);
    }
    public time():number[]{
        return this.send(CmdTime).wait(castNumbers);
    }
    public slowlog(subCommand, ...subArgs){
        return this.send(CmdSlowlog, ...arguments).wait(deepCastStrs);
    }
    public slowlogLen(){
        return this.slowlog("len");
    }
    public slowlogGet(n:number){
        return this.slowlog("get",n);
    }
    public config(subCommand, ...subArgs){
        return this.send(CmdConfig, subCommand, ...arguments).wait(deepCastStrs);
    }
    protected pre_trans(){
        if(this._sub_backs){
            throw new RedisError("in_subscribe_context");
        }
    }
    public watch(...keys):boolean{
        this.pre_trans();
        keys=util.isArray(keys[0])?keys[0]:keys;
        keys=this._fix_prefix_any(keys);
        return this.send(CmdWatch, ...keys).wait(castBool);
    }
    public unwatch():boolean{
        this.pre_trans();
        return this.send(CmdUnWatch).wait(castBool);
    }
    public multi():Redis{
        this.pre_trans();
        if(!this._mult_backs){
            this._mult_backs = [];
            try{
                this.send(CmdMulti).wait(castBool);
                this._mult_backs = [];
            }catch(e){
                this._mult_backs = null;
                throw e;
            }
        }
        return this;
    }
    public exec():any[]{
        this.pre_trans();
        var fns=this._mult_backs;
        this._mult_backs=null;
        return this.send(CmdExec).wait(function(a){
            a.forEach((v,k,o)=>{
                o[k] = fns[k]?fns[k](v):v;
            });
            return a;
        });
    }
    private assertNomal(){
        if(this._mult_backs || this._sub_backs){
            throw new RedisError("in_mult_ctx or in_subscribe_ctx");
        }
    }
    public pipeline(fn:(r:Redis)=>void):any[]{
        this.assertNomal();
        let p = new RedisPipeLine(this);
        fn(p);
        return p.pipeSubmit();
    }
    public pipeOpen():Redis{
        this.assertNomal();
        return new RedisPipeLine(this);
    }
    public pipeSubmit():any[]{
        throw "redis_not_in_pipeline";
    }
    private pipelineSubmitBridge(commands:Class_Buffer[], casts:any[]){
        this.assertNomal();
        this.beforeSend();
        var events = new PipelineOptEvent(casts);
        casts.forEach(e=>{
            this._backs.push(events);
        });
        this._sendBufs.push(...commands);
        this._sendEvt.set();
        return events.waitAll(true);
    }

    public keys(pattern:string|Class_Buffer):string[]{
        pattern=this._fix_prefix_any(pattern);
        return this.send(CmdKeys, pattern).wait(castStrs);
    }
    public exists(key:string|Class_Buffer):boolean{
        key=this._fix_prefix_any(key);
        return this.send(CmdExists, key).wait(castBool);
    }
    public type(key:string|Class_Buffer):string{
        key=this._fix_prefix_any(key);
        return this.send(CmdType, key).wait(castStr);
    }
    public rename(key:string|Class_Buffer,newkey:string|Class_Buffer):boolean{
        key=this._fix_prefix_any(key);newkey=this._fix_prefix_any(newkey);
        return this.send(CmdRename,key,newkey).wait(castBool);
    }
    public renameNX(key:string|Class_Buffer,newkey:string|Class_Buffer):boolean{
        key=this._fix_prefix_any(key);newkey=this._fix_prefix_any(newkey);
        return this.send(CmdRenameNX,key,newkey).wait(castBool);
    }
    public dump(key:string|Class_Buffer):string{
        key=this._fix_prefix_any(key);
        return this.send(CmdDump, key).wait(castStr);
    }
    public touch(...keys):number{
        keys=util.isArray(keys[0])?keys[0]:keys;
        keys=this._fix_prefix_any(keys);
        return this.send(CmdTouch, ...keys).wait(castNumber);
    }
    public move(key:string|Class_Buffer, toDb:number):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdMove, key, toDb).wait(castNumber);
    }
    public randomKey():string{
        return this.send(CmdRandomkey).wait(castStr);
    }
    public del(...keys):number{
        keys=util.isArray(keys[0])?keys[0]:keys;
        keys=this._fix_prefix_any(keys);
        return this.send(CmdDel, ...keys).wait(castNumber);
    }
    public unlink(...keys):number{
        keys=util.isArray(keys[0])?keys[0]:keys;
        keys=this._fix_prefix_any(keys);
        return this.send(CmdUnlink, ...keys).wait(castNumber);
    }
    public expire(key:string|Class_Buffer, ttl:number=0):boolean{
        key=this._fix_prefix_any(key);
        return this.send(CmdExpire, key,ttl).wait(castBool);
    }
    public pexpire(key:string|Class_Buffer, ttl:number=0):boolean{
        key=this._fix_prefix_any(key);
        return this.send(CmdPexpire, key,ttl).wait(castBool);
    }
    public pttl(key:string|Class_Buffer):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdPttl, key).wait(castNumber);
    }
    public ttl(key:string|Class_Buffer):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdTtl, key).wait(castNumber);
    }
    public persist(key:string|Class_Buffer):boolean{
        key=this._fix_prefix_any(key);
        return this.send(CmdPersist, key).wait(castBool);
    }
    public set(key:string|Class_Buffer, val:any, ttl:number=0):boolean{
        key=this._fix_prefix_any(key);
        if(ttl<1){
            return this.send(CmdSet,key,val).wait(castBool);
        }
        return this.send(CmdSet,key,val,CmdOptEX,ttl).wait(castBool);
    }
    public add(key:string|Class_Buffer, val:any, ttl:number=0):boolean{
        key=this._fix_prefix_any(key);
        if(ttl<1){
            return this.send(CmdSet,key,val,CmdOptNX).wait(castBool);
        }
        return this.send(CmdSet,key,val,CmdOptEX,ttl,CmdOptNX).wait(castBool);
    }
    public setNX(key:string|Class_Buffer, val:any, ttl:number=0):boolean{
        key=this._fix_prefix_any(key);
        if(ttl<1){
            return this.send(CmdSet,key,val,CmdOptNX).wait(castBool);
        }
        return this.send(CmdSet,key,val,CmdOptEX,ttl,CmdOptNX).wait(castBool);
    }
    public setXX(key:string|Class_Buffer, val:any, ttl:number=0):boolean{
        key=this._fix_prefix_any(key);
        if(ttl<1){
            return this.send(CmdSet,key,val,CmdOptXX).wait(castBool);
        }
        return this.send(CmdSet,key,val,CmdOptEX,ttl,CmdOptXX).wait(castBool);
    }
    public mset(...kvs):boolean{
        kvs=kvs.length==1?toArray(kvs[0],[]):kvs;
        for(var i=0;i<kvs.length;i+=2){
            kvs[i]=this._fix_prefix_any(kvs[i]);
        }
        return this.send(CmdMSet, ...kvs).wait(castBool);
    }
    public msetNX(...kvs):boolean{
        kvs=kvs.length==1?toArray(kvs[0],[]):kvs;
        for(var i=0;i<kvs.length;i+=2){
            kvs[i]=this._fix_prefix_any(kvs[i]);
        }
        return this.send(CmdMSetNX, ...kvs).wait(castBool);
    }
    public append(key:string|Class_Buffer, val:string|Class_Buffer):boolean{
        key=this._fix_prefix_any(key);
        return this.send(CmdAppend, key, val).wait(castBool);
    }
    public setRange(key:string|Class_Buffer, offset:number, val:string|Class_Buffer):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdSetRange, key, offset, val).wait(castNumber);
    }
    public getRange(key:string|Class_Buffer, start:number, end:number, castFn:Function=castStr):string{
        key=this._fix_prefix_any(key);
        return this.send(CmdGetRange, key, start, end).wait(castFn);
    }
    public substr(key:string|Class_Buffer, start:number, end:number, castFn:Function=castStr):string|Class_Buffer{
        key=this._fix_prefix_any(key);
        return this.send(CmdSubstr, key, start, end).wait(castFn);
    }
    public strlen(key:string|Class_Buffer):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdStrlen, key).wait(castNumber);
    }
    public get(key:string|Class_Buffer, castFn:Function=castStr):any{
        key=this._fix_prefix_any(key);
        return this.send(CmdGet, key).wait(castFn);
    }
    public mget(keys:string[], castFn:Function=castStrs):any[]{
        var keys=this._fix_prefix_any(keys);
        return this.send(CmdMGet, ...keys).wait(castFn);
    }
    public mgetWrap(keys:string[], castFn:Function=castStrs):{[index:string]:any}{
        var a = this.mget(keys, castFn);
        var r = {};
        keys.forEach((k,i)=>{
            r[k] = a[i];
        });
        return r;
    }
    public mgetWrap2(keys:any[], fixKeyPathFn:(k:any)=>string, castFn:Function=castStrs):{[index:string]:any}{
        var a = this.mget(keys.map(fixKeyPathFn), castFn);
        var r = {};
        keys.forEach((k,i)=>{
            r[k] = a[i];
        });
        return r;
    }
    public getSet(key:string|Class_Buffer, val:any, castFn:Function=castStr):any{
        key=this._fix_prefix_any(key);
        return this.send(CmdGetSet, key, val).wait(castFn);
    }
    public incr(key:string|Class_Buffer, castFn:Function=castNumber):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdIncr,key).wait(castFn);
    }
    public decr(key:string|Class_Buffer, castFn:Function=castNumber):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdDecr,key).wait(castFn);
    }
    public incrBy(key:string|Class_Buffer, step:number, castFn:Function=castNumber):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdIncrBy,key,step).wait(castFn);
    }
    public decrBy(key:string|Class_Buffer, step:number, castFn:Function=castNumber):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdDecrBy,key,step).wait(castFn);
    }
    public bitCount(key:string|Class_Buffer):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdBitcount, key).wait(castNumber);
    }
    public bitPos(key:string|Class_Buffer, start:number, end?:number):number{
        key=this._fix_prefix_any(key);
        if(arguments.length>2){
            return this.send(CmdBitpos, key, start, end).wait(castNumber);
        }
        return this.send(CmdBitpos, key, start).wait(castNumber);
    }
    public bitOp(option:'AND'|'OR'|'NOT'|'XOR', destkey:string|Class_Buffer, ...keys):number{
        keys.unshift(destkey);
        keys=this._fix_prefix_any(keys);
        keys.unshift(option);
        return this.send(CmdBitop, ...keys).wait(castNumber);
    }
    public setBit(key:string|Class_Buffer, offset:number, val:number):boolean{
        key=this._fix_prefix_any(key);
        return this.send(CmdSetbit, key, offset, val).wait(castBool);
    }
    public getBit(key:string|Class_Buffer, offset:number):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdGetbit, key, offset).wait(castNumber);
    }

    private _scan_act(parse:Function, cmd:string, key:string|Class_Buffer, cursor:any, matchPattern?:string|Class_Buffer, matchCount?:number){
        var args:Array<any>=cmd=='scan'?[cmd, cursor]:[cmd,key,cursor];
        if(matchPattern&&matchPattern.length>0){
            args.push('MATCH',matchPattern);
        }
        if(Number.isInteger(matchCount)){
            args.push('COUNT',matchCount);
        }
        return this.send(...args).wait(a=>{
            a[0]=Number(a[0].toString());
            a[1]=parse(a[1]);
            if(cmd=='hscan'||cmd=='zscan'){
                var arr=a[1];
                var obj={}
                for(var i=0;i<arr.length;i+=2){
                    obj[arr[i].toString()]=arr[i+1];
                }
                a[1]=obj;
            }
            a.cursor=a[0];
            a.list=a[1];
            return a;
        });
    }
    public scan(cursor:any, matchPattern?:string|Class_Buffer, matchCount?:number, castFn:Function=castStrs):any[]{
        matchPattern=this._fix_prefix_any(matchPattern);
        return this._scan_act(castFn, 'scan', null, cursor, matchPattern, matchCount);
    }
    public sscan(key:string|Class_Buffer, cursor:any, matchPattern?:string|Class_Buffer, matchCount?:number, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this._scan_act(castFn, 'sscan', key, cursor, matchPattern, matchCount);
    }
    public hscan(key:string|Class_Buffer, cursor:any, matchPattern?:string|Class_Buffer, matchCount?:number, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this._scan_act(castFn, 'hscan', key, cursor, matchPattern, matchCount);
    }
    public zscan(key:string|Class_Buffer, cursor:any, matchPattern?:string|Class_Buffer, matchCount?:number, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this._scan_act(castFn, 'zscan', key, cursor, matchPattern, matchCount);
    }

    public geoadd(key:string|Class_Buffer, ...LngLatMembers):number{
        key=this._fix_prefix_any(key);
        LngLatMembers.unshift('geoadd',key);
        return this.send(...LngLatMembers).wait(castNumber);
    }
    public geodist(key:string|Class_Buffer, m1:any, m2:any, unit?:string):number{
        key=this._fix_prefix_any(key);
        var args=['geodist',key,m1,m2];
        if(unit){
            args.push(unit);
        }
        return this.send(...args).wait(castNumber);
    }
    public geohash(key:string|Class_Buffer, ...members):string[]{
        key=this._fix_prefix_any(key);
        members.unshift('geohash',key);
        return this.send(...members).wait(castStrs);
    }
    public geopos(key:string|Class_Buffer, ...members){
        key=this._fix_prefix_any(key);
        members.unshift('geopos',key);
        var a=this.send(...members).wait();
        a.forEach((v,k,o)=>{
            if(v){
                v[0]=Number(v[0]);
                v[1]=Number(v[1]);
                o[k]=v;
            }
        });
        return a;
    }
    public georadius(key:string|Class_Buffer, longitude:string|number, latitude:string|number, radius:string|number, unit:string, withOpts?:Array<string>){
        key=this._fix_prefix_any(key);
        var args=['georadius', key, longitude, latitude, radius, unit];
        if(withOpts){
            withOpts.forEach(v=>{
                args.push(v);
            });
        }
        var a=this.send(...args).wait();
        a.forEach((v,k,o)=>{
            v[0]=v[0].toString();
            if(Array.isArray(v[1])){
                v[1].forEach((vv,kk,oo)=>{
                    oo[kk]=Number(vv);
                });
            }
            o[k]=v;
        });
        return a;
    }
    public georadiusbymember(key:string|Class_Buffer, member:any, radius:string|number, unit:string):string[]{
        key=this._fix_prefix_any(key);
        var args=['georadiusbymember',key,member,radius,unit];
        return this.send(...args).wait(castStrs);
    }

    protected pre_block(){
    }

    public lPush(key:string|Class_Buffer, ...vals):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdLpush, key, ...vals).wait(castNumber);
    }
    public rPush(key:string|Class_Buffer, ...vals):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdRpush, key, ...vals).wait(castNumber);
    }
    public lPushx(key:string|Class_Buffer, val:any):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdLpushx, key, val).wait(castNumber);
    }
    public rPushx(key:string|Class_Buffer, val:any):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdRpushx, key, val).wait(castNumber);
    }
    public lLen(key:string|Class_Buffer):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdLlen, key).wait(castNumber);
    }
    public lPop(key:string|Class_Buffer, castFn:Function=castStr):any{
        key=this._fix_prefix_any(key);
        return this.send(CmdLpop, key).wait(castFn);
    }
    public rPop(key:string|Class_Buffer, castFn:Function=castStr):any{
        key=this._fix_prefix_any(key);
        return this.send(CmdRpop, key).wait(castFn);
    }
    public lIndex(key:string|Class_Buffer, offset:number, castFn:Function=castStr):any{
        key=this._fix_prefix_any(key);
        return this.send(CmdLindex, key, offset).wait(castFn);
    }
    public lInsert(key:string|Class_Buffer, pivot:any, val:any, toBefore:boolean=true):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdLinsert, key, toBefore?'BEFORE':'AFTER', pivot, val).wait(castNumber);
    }
    public lSet(key:string|Class_Buffer, index:number, val:any):boolean{
        key=this._fix_prefix_any(key);
        return this.send(CmdLset, key, index, val).wait(castBool);
    }
    public lRem(key:string|Class_Buffer, count:number, val:any):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdLrem, key, count, val).wait(castNumber);
    }
    public lTrim(key:string|Class_Buffer, start:number, stop:number):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdLtrim, key, start, stop).wait(castNumber);
    }
    public lRange(key:string|Class_Buffer, start:number, stop:number, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this.send(CmdLrange, key, start, stop).wait(castFn);
    }
    public bLpop(key:string|Class_Buffer|Array<string|Class_Buffer>, timeout:number, castFn:Function=castStrs):any[]{
        this.pre_block();
        key=this._fix_prefix_any(key);
        var args=Array.isArray(key) ? [CmdBlpop, ...key, timeout]:[CmdBlpop, key, timeout];
        return this.send(...args).wait(castFn);
    }
    public bRpop(key:string|Class_Buffer|Array<string|Class_Buffer>, timeout:number, castFn:Function=castStrs):any[]{
        this.pre_block();
        key=this._fix_prefix_any(key);
        var args=Array.isArray(key) ? [CmdBrpop, ...key, timeout]:[CmdBrpop, key, timeout];
        return this.send(...args).wait(castFn);
    }
    public bRpopLpush(srcKey:string|Class_Buffer, destKey:string|Class_Buffer, timeout:number, castFn:Function=castStr):any{
        this.pre_block();
        srcKey=this._fix_prefix_any(srcKey); destKey=this._fix_prefix_any(destKey);
        var args=[CmdBrpopLpush, srcKey, destKey, timeout];
        return this.send(...args).wait(castFn);
    }
    public rPopLpush(srcKey:string|Class_Buffer, destKey:string|Class_Buffer, castFn:Function=castStr):any{
        this.pre_block();
        srcKey=this._fix_prefix_any(srcKey); destKey=this._fix_prefix_any(destKey);
        return this.send(CmdRpopLpush, srcKey, destKey).wait(castFn);
    }

    public hSet(key:string|Class_Buffer, field:string|Class_Buffer|number, val:any ):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdHSet, key, field, val).wait(castNumber);
    }
    public hSetNx(key:string|Class_Buffer, field:string|Class_Buffer|number, val:any ):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdHSetNx, key, field, val).wait(castNumber);
    }
    public hGet(key:string|Class_Buffer, field:string|Class_Buffer|number, castFn:Function=castStr ):any{
        key=this._fix_prefix_any(key);
        return this.send(CmdHGet, key, field).wait(castFn);
    }
    public hLen(key:string|Class_Buffer):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdHLen, key).wait(castNumber);
    }
    public hDel(key:string|Class_Buffer, ...fields):number{
        key=this._fix_prefix_any(key);
        fields=util.isArray(fields[0])?fields[0]:fields;
        return this.send(CmdHdel, ...fields).wait(castNumber);
    }
    public hKeys(key:string|Class_Buffer, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this.send(CmdHKeys, key).wait(castFn);
    }
    public hVals(key:string|Class_Buffer, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this.send(CmdHVals, key).wait(castFn);
    }
    public hGetAll(key:string|Class_Buffer, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this.send(CmdHGetAll, key).wait(castFn);
    }
    public hGetAllWrap(key:string|Class_Buffer, castFn:Function=castStrs):{[index:string]:any}{
        var a = this.hGetAll(key, castFn);
        var r = {};
        for(var i=0;i<a.length;i+=2){
            r[a[i].toString()] = a[i+1];
        }
        return r;
    }
    public hExists(key:string|Class_Buffer, field:string|Class_Buffer|number):boolean{
        key=this._fix_prefix_any(key);
        return this.send(CmdHExists, key, field).wait(castBool);
    }
    public hIncrBy(key:string|Class_Buffer, field:string|Class_Buffer|number, val:number|string|{toString():string}, castFn:Function=castNumber):any{
        key=this._fix_prefix_any(key);
        return this.send(CmdHIncrBy, key, field, val).wait(castFn);
    }
    public hIncrByFloat(key:string|Class_Buffer, field:string|Class_Buffer|number, val:number|string|{toString():string}):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdHIncrByFloat, key, field, val).wait(castNumber);
    }
    public hMset(key:string|Class_Buffer, hashObj:{[index:string]:any}):boolean{
        key=this._fix_prefix_any(key);
        var args = [CmdHMset, key];
        for(var k in hashObj){
            args.push(k, hashObj[k]);
        }
        return this.send(...args).wait(castBool);
    }
    public hMGet(key:string|Class_Buffer, fields:Array<string|Class_Buffer|number>, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        if(!fields || fields.length<1)return [];
        return this.send(CmdHMget, key, ...fields).wait(castFn);
    }
    public hMGetWrap(key:string|Class_Buffer, fields:Array<string|Class_Buffer|number>, castFn:Function=castStrs):{[index:string]:any}{
        key=this._fix_prefix_any(key);
        if(!fields || fields.length<1)return [];
        var a = this.send(CmdHMget, key, ...fields).wait(castFn);
        var r = {};
        for(var i=0;i<fields.length;i++){
            r[fields[i].toString()] = a[i];
        }
        return r;
    }

    public sAdd(key:string|Class_Buffer, ...members):number{
        key=this._fix_prefix_any(key);
        members=util.isArray(members[0])?members[0]:members;
        return this.send(CmdSadd, key, ...members).wait(castNumber);
    }
    public sRem(key:string|Class_Buffer, ...members):number{
        key=this._fix_prefix_any(key);
        members=util.isArray(members[0])?members[0]:members;
        return this.send(CmdSrem, key, ...members).wait(castNumber);
    }
    public sCard(key:string|Class_Buffer):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdScard, key).wait(castNumber);
    }
    public sPop(key:string|Class_Buffer, num:number=1, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this.send(CmdSpop, key, num).wait(castFn);
    }
    public sRandmember(key:string|Class_Buffer, num:number=1, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this.send(CmdSrandmember, key, num).wait(castFn);
    }
    public sIsmember(key:string|Class_Buffer, member:any):boolean{
        key=this._fix_prefix_any(key);
        return this.send(CmdSismember, key, member).wait(castBool);
    }
    public sDiff(keys:Array<string|Class_Buffer>, castFn:Function=castStrs):any[]{
        keys=this._fix_prefix_any(keys);
        return this.send(CmdSdiff, ...keys).wait(castFn);
    }
    public sDiffStore(destKey:string|Class_Buffer, keys:Array<string|Class_Buffer>):number{
        keys.unshift(destKey);
        keys=this._fix_prefix_any(keys);
        return this.send(CmdSdiffStore, destKey, ...keys).wait(castNumber);
    }
    public sInter(keys:Array<string|Class_Buffer>, castFn:Function=castStrs):any[]{
        keys=this._fix_prefix_any(keys);
        return this.send(CmdSinter, ...keys).wait(castFn);
    }
    public sInterStore(destKey:string|Class_Buffer, keys:Array<string|Class_Buffer>):number{
        keys.unshift(destKey);
        keys=this._fix_prefix_any(keys);
        return this.send(CmdSinterStore, ...keys).wait(castNumber);
    }
    public sUnion(keys:Array<string|Class_Buffer>, castFn:Function=castStrs):any[]{
        keys=this._fix_prefix_any(keys);
        return this.send(CmdSunion, ...keys).wait(castFn);
    }
    public sUnionStore(destKey:string|Class_Buffer, keys:Array<string|Class_Buffer>):number{
        keys.unshift(destKey);
        keys=this._fix_prefix_any(keys);
        return this.send(CmdSunionStore, ...keys).wait(castNumber);
    }
    public sMembers(key:string|Class_Buffer, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this.send(CmdSmembers,key).wait(castFn);
    }
    public sMove(sourceKey:string|Class_Buffer, destKey:string|Class_Buffer, member:any):number{
        var keys=[sourceKey,destKey];
        keys=this._fix_prefix_any(keys);
        return this.send(CmdSmove, ...keys, member).wait(castNumber);
    }
    //opts = [NX|XX] [CH] [INCR]
    public zAdd(key:string|Class_Buffer, opts:string[], ...score2members):number{
        key=this._fix_prefix_any(key);
        var smsArr:Array<any>=score2members;
        if(!opts || opts.length<1){
            return this.send(CmdZadd, key, ...smsArr).wait(castNumber);
        }
        return this.send(CmdZadd, key, opts.join(''), ...smsArr).wait(castNumber);
    }
    //opts = [NX|XX] [CH] [INCR]
    public zAddByKV(key:string|Class_Buffer, sms:{[index:string]:number}, opts?:Array<string>):number{
        key=this._fix_prefix_any(key);
        var smsArr:Array<any>=toZsetArray(sms,[]);
        if(!opts || opts.length<1){
            return this.send(CmdZadd, key, ...smsArr).wait(castNumber);
        }
        return this.send(CmdZadd, key, opts.join(''), ...smsArr).wait(castNumber);
    }
    //opts = [NX|XX] [CH] [INCR]
    public zAddOne(key:string|Class_Buffer, member:any, score:number, opts?:Array<string>):number{
        key=this._fix_prefix_any(key);
        if(!opts || opts.length<1){
            return this.send(CmdZadd, key, score, member).wait(castNumber);
        }
        return this.send(CmdZadd, key, opts.join(''), score, member).wait(castNumber);
    }
    public zIncrBy(key:string|Class_Buffer, member:any, increment:number, castFn:Function=castNumber):number|any{
        key=this._fix_prefix_any(key);
        return this.send(CmdZincrBy, key, increment, member).wait(castFn);
    }
    public zCard(key:string|Class_Buffer):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdZcard, key).wait(castNumber);
    }
    public zCount(key:string|Class_Buffer, min:string|number, max:string|number):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdZcount, key, min, max).wait(castNumber);
    }
    public zLexCount(key:string|Class_Buffer, min:string|number, max:string|number):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdZlexcount, key, min, max).wait(castNumber);
    }
    public zScore(key:string|Class_Buffer, member:any, castFn=castNumber):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdZscore, key, member).wait(castFn);
    }
    public zRank(key:string|Class_Buffer, member:any):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdZrank, key, member).wait(castNumber);
    }
    public zRevRank(key:string|Class_Buffer, member:any):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdZrevRank, key, member).wait(castNumber);
    }
    public zRem(key:string|Class_Buffer, ...members):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdZrem, key, ...members).wait(castNumber);
    }
    public zRemByLex(key:string|Class_Buffer, min:string|number, max:string|number):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdZremRangeByLex, key, min,max).wait(castNumber);
    }
    public zRemByScore(key:string|Class_Buffer, min:string|number, max:string|number):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdZremRangeByScore, key, min,max).wait(castNumber);
    }
    public zRemByRank(key:string|Class_Buffer, start:number, stop:number):number{
        key=this._fix_prefix_any(key);
        return this.send(CmdZremRangeByRank, key, start,stop).wait(castNumber);
    }
    private _z_act(castFn, scorePv:number, args:Array<any>){
        var r=this.send(...args).wait(castFn);
        if(scorePv==0){
            return r;
        }
        var list=[];
        for(var i=0;i<r.length;i+=2){
            list.push({member:r[i],score:Number(r[i+1].toString())});
        }
        return list;
    }
    public zPopMin(key:string|Class_Buffer, num:number=1, castFn:Function=castStrs):Array<{member:string|number, score:number}>{
        key=this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZpopmin, key, num]);
    }
    public zPopMax(key:string|Class_Buffer, num:number=1, castFn:Function=castStrs):Array<{member:string|number, score:number}>{
        key=this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZpopmax, key, num]);
    }
    public zRange(key:string|Class_Buffer, start:number, stop:number, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this._z_act(castFn, 0, [CmdZrange, key, start, stop]);
    }
    public zRangeWithscore(key:string|Class_Buffer, start:number, stop:number, castFn:Function=castStrs):Array<{member:string|number, score:number}>{
        key=this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZrange, key, start, stop, "WITHSCORES"]);
    }
    public zRevRange(key:string|Class_Buffer, start:number, stop:number, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        return this._z_act(castFn, 0, [CmdZrevRange, key, start, stop]);
    }
    public zRevRangeWithscore(key:string|Class_Buffer, start:number, stop:number, castFn:Function=castStrs):Array<{member:string|number, score:number}>{
        key=this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZrevRange, key, start, stop, "WITHSCORES"]);
    }
    public zRangeByScore(key:string|Class_Buffer, min:number, max:number, opts:{withScore?:boolean, limit?:{offset:number,count:number}}={withScore:false}, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        var args = [CmdZrangeByScore, key, Math.min(min,max), Math.max(min,max)];
        if(opts.limit){
            args.push('LIMIT',opts.limit.offset,opts.limit.count);
        }
        if(opts.withScore){
            args.push("WITHSCORES");
        }
        return this._z_act(castFn, opts.withScore?1:0, args);
    }
    public zRevRangeByScore(key:string|Class_Buffer, min:number, max:number, opts:{withScore?:boolean, limit?:{offset:number,count:number}}={withScore:false}, castFn:Function=castStrs):any[]{
        key=this._fix_prefix_any(key);
        var args = [CmdZrevrangeByScore, key, Math.max(min,max), Math.min(min,max)];
        if(opts.limit){
            args.push('LIMIT',opts.limit.offset,opts.limit.count);
        }
        if(opts.withScore){
            args.push("WITHSCORES");
        }
        return this._z_act(castFn, opts.withScore?1:0, args);
    }
    public bzPopMin(key:string|Class_Buffer|Array<string|Class_Buffer>, timeout:number=0, castFn:Function=castStr):Array<string|number>{
        this.pre_block();
        key=this._fix_prefix_any(key);
        var args = Array.isArray(key) ? [CmdBzPopMin, ...key, timeout]:[CmdBzPopMin, key, timeout];
        var r=this.send(...args).wait();
        r[0]=r[0].toString();
        r[1]=Number(r[1].toString());
        r[2]=castFn(r[2]);
        return r;
    }
    public bzPopMax(key:string|Class_Buffer|Array<string|Class_Buffer>, timeout:number=0, castFn:Function=castStr):Array<string|number>{
        this.pre_block();
        key=this._fix_prefix_any(key);
        var args = Array.isArray(key) ? [CmdBzPopMax, ...key, timeout]:[CmdBzPopMax, key, timeout];
        var r=this.send(...args).wait();
        r[0]=r[0].toString();
        r[1]=Number(r[1].toString());
        r[2]=castFn(r[2]);
        return r;
    }

    public pfAdd(key:string|Class_Buffer, ...elements){
        var keys=util.isArray(elements[0])?elements[0]:elements;
        keys=this._fix_prefix_any(keys);
        return this.send(CmdPfadd, ...keys).wait();
    }
    public pfCount(key:string|Class_Buffer){
        key=this._fix_prefix_any(key);
        return this.send(CmdPfcount, key).wait();
    }
    public pfMerge(destKey:string|Class_Buffer, ...sourceKeys){
        var keys=util.isArray(sourceKeys[0])?sourceKeys[0]:sourceKeys;
        keys.unshift(destKey);
        keys=this._fix_prefix_any(sourceKeys);
        return this.send(CmdPfmerge, ...keys).wait(castBool);
    }

    public publish(channel:string|Class_Buffer, data:any):number{
        return this.send(CmdPublish, channel, data).wait();
    }
    public pubsub(subCmd:string|Class_Buffer, ...args):string[]|number{
        let fn = subCmd.toString().toLocaleLowerCase()!="numpat" ? castStrs:castNumber;
        return this.send(CmdPubsub, subCmd, ...args).wait(fn);
    }
    public pubsubChannels():string[]{
        return this.send(CmdPubsub, "channels").wait(castStrs);
    }
    public pubsubNumSub(...channels):{[index:string]:number}{
        let r = this.send(CmdPubsub, "numsub", ...channels).wait(castStrs);
        let m={};
        for(var i=0;i<r.length;i+=2){
            m[r[i]]=Number(r[i+1]);
        }
        return m;
    }
    public pubsubNumPat():number{
        return this.send(CmdPubsub, "numpat").wait(castNumber);
    }
    private _real_sub(cmd, key:string, fn:(d:Class_Buffer, chan?:string)=>void, isSubscribe?:boolean){
        this.pre_sub();
        var r=this.send(cmd, key).wait();
        var fns:{[index:string]:Array<Function>} = isSubscribe ? this._subFn:this._psubFn;
        if(fns[key]==null){
            fns[key]=[];
        }
        fns[key].push(fn);
        return r;
    }
    public subscribe(key:string|string[], fn:(d:Class_Buffer, chan?:string)=>void):number{
        // if(key==null||key.length<1||!util.isFunction(fn))return;
        key=this._fix_prefix_str(key);
        let n:number;
        if(util.isArray(key)){
            var arr:string[] = <string[]>key;
            arr.forEach(e=>{
                n=this._real_sub(CmdSubscribe, e,fn, true);
            })
        }else{
            n=this._real_sub(CmdSubscribe, key.toString(),fn, true);
        }
        return n;
    }
    public psubscribe(key:string|string[], fn:(d:Class_Buffer, chan?:string)=>void):number{
        // if(key==null||key.length<1||!util.isFunction(fn))return;
        key=this._fix_prefix_str(key);
        let n:number;
        if(util.isArray(key)){
            var arr:string[] = <string[]>key;
            arr.forEach(e=>{
                n=this._real_sub(CmdPSubscribe, e,fn, false);
            })
        }else{
            n=this._real_sub(CmdPSubscribe, key.toString(),fn, false);
        }
        return n;
    }
    private _real_unsub(cmd, key:string, fn, fns:{[index:string]:Array<Function>}){
        if(!fns){
            return 0;
        }
        var r = this.send(cmd, key).wait();
        var idx = fns[key].indexOf(fn);
        if(idx>-1){
            fns[key].splice(idx,1);
        }
        if(r<1){
            delete fns[key];
        }
        this.after_unsub();
        return r;
    }
    public unsubscribe(key:string, fn:Function):number{
        key=this._fix_prefix_str(key);
        return this._real_unsub(CmdUnSubscribe, key, fn, this._subFn);
    }
    public punsubscribe(key:string, fn:Function):number{
        key=this._fix_prefix_str(key);
        return this._real_unsub(CmdPUnSubscribe, key, fn, this._psubFn);
    }
    public unsubscribeAll(key:string){
        key=this._fix_prefix_str(key);
        var fns=this._subFn;
        var num = fns&&fns[key] ? fns[key].length :1;
        for(var i=0;i<(num+1);i++){
            this._real_unsub(CmdUnSubscribe, key, null, fns);
        }
    }
    public punsubscribeAll(key:string){
        key=this._fix_prefix_str(key);
        var fns=this._psubFn;
        var num = fns&&fns[key] ? fns[key].length :1;
        for(var i=0;i<(num+1);i++){
            this._real_unsub(CmdPUnSubscribe, key, null, fns);
        }
    }
    protected pre_sub(){
        // if(!this._connected){
        //     throw new RedisError("io_error");
        // }
        if(!this._sub_backs){
            if(this._mult_backs){
                throw new RedisError("in_mult_exec");
            }
            if(this._backs.length>0){
                this._backs[this._backs.length-1].wait();
            }
            this._sub_backs=[];
            this._subFn={};
            this._psubFn={};
        }
    }
    private after_unsub(){
        if(Object.keys(this._subFn).length<1 && Object.keys(this._psubFn).length<1){
            if(this._sub_backs.length>0){
                this._sub_backs[this._sub_backs.length-1].wait();
                this.after_unsub();
                return;
            }
            this._sub_backs=null;
            this._subFn=null;
            this._psubFn=null;
        }
    }
    private pre_sub_onConnect(){
        var subFn=this._subFn;
        var psubFn=this._psubFn;
        var had = (subFn && Object.keys(subFn).length>0) || (psubFn && Object.keys(psubFn).length>0);
        this._sub_backs=null;
        this._subFn=null;
        this._psubFn=null;
        if(had){
            try{
                if(subFn){
                    for(var k in subFn){
                        var arr=subFn[k];
                        for(var i=0;i<arr.length;i++){
                            this.subscribe(k, arr[i]);
                        }
                    }
                }
                if(psubFn){
                    for(var k in psubFn){
                        var arr=psubFn[k];
                        for(var i=0;i<arr.length;i++){
                            this.psubscribe(k, arr[i]);
                        }
                    }
                }
            }catch (e) {
                this._subFn=subFn;
                this._psubFn=psubFn;
            }
        }
    }
    private _on_subReply(reply){
        if(!util.isArray(reply)){
            if(RET_OK.compare(reply)==0){
                this._sub_backs.shift().then(true);
            }else if(RET_PONG.compare(reply)==0){
                this._sub_backs.shift().then('PONG');
            }
        }else if(CmdMessage.compare(reply[0])==0){
            var channel=reply[1].toString();
            this._subFn[channel].forEach(f=>{
                f(reply[2], channel);
            })
        }else if(CmdPMessage.compare(reply[0])==0){
            var channel=reply[1].toString();
            this._psubFn[channel].forEach(f=>{
                f(reply[2], channel);
            });
        }else{
            if(CmdUnSubscribe.compare(reply[0])==0){
                this._sub_backs.shift().then(reply.length>2?parseInt(reply[2].toString()):0);
            }else if(CmdPUnSubscribe.compare(reply[0])){
                this._sub_backs.shift().then(reply.length>2?parseInt(reply[2].toString()):0);
            }else if(RET_PONG.compare(reply[0])==0){
                this._sub_backs.shift().then('pong');
            }else{
                this._sub_backs.shift().then(reply);
            }
        }
    }
    private _fix_prefix_str<T>(k:T):T{
        if(!this._prefix.buf){
            return k;
        }
        if(util.isArray(k)){
            var b:Array<any>=<any>k;
            b.forEach((k,i,a)=>{
                a[i] = this._prefix.str+k;
            });
            return k;
        }
        return <any>this._prefix.str+k;
    }
    private _fix_prefix_any<T>(k:T):T {
        if(!this._prefix.buf){
            return k;
        }
        if(util.isArray(k)){
            var b:Array<any>=<any>k;
            b.forEach((k,i,a)=>{
                if(util.isBuffer(k)){
                    a[i] = Buffer.concat([this._prefix.buf,k]);
                }else{
                    a[i] = Buffer.from(this._prefix.str+k);
                }
            });
            return k;
        }
        if(util.isBuffer(k)){
            return <any>Buffer.concat([this._prefix.buf,k]);
        }
        return <any>Buffer.from(this._prefix.str+k);
    }

    public static castBool:(bufs:any)=>boolean;
    public static castAuto:(bufs:any)=>any;
    public static castStr:(bufs:any)=>string;
    public static castStrs:(bufs:any)=>string[];
    public static castNumber:(bufs:any)=>number;
    public static castNumbers:(bufs:any)=>number[];

    public static castBigInt:(bufs:any)=>any;
    public static castBigInts:(bufs:any)=>any[];
}

class OptEvent{
    protected evt:Class_Event;
    protected data;
    protected err;
    public constructor(){
        this.evt=new coroutine.Event(false);
    }
    public wait(convert?:Function){
        this.evt.wait();
        if(this.err){
            throw this.err;
        }
        return convert ? convert(this.data):this.data;
    }
    public then(data){
        this.data=data;
        this.evt.set();
    }
    public fail(e){
        this.err=e;
        this.evt.set();
    }
}
class PipelineOptEvent extends OptEvent{
    protected evt:Class_Event;
    protected fns:Array<Function>;
    protected rets:Array<any>;
    protected errs:Array<any>;
    public constructor(fns:Array<Function>){
        super();
        this.fns=fns;
        this.rets=[];
        this.errs=[];
    }
    public waitAll(throwErr?:boolean){
        this.evt.wait();
        if(this.errs.length>0){
            if(throwErr){
                throw this.errs[0];
            }
        }
        return this.rets;
    }
    public then(data){
        var fn=this.fns[this.rets.length];
        this.rets.push(fn ? fn(data):data);
        this.check();
    }
    public fail(e){
        this.rets.push(undefined);
        this.errs.push(e);
        this.check();
    }
    private check(){
        if(this.rets.length>=this.fns.length){
            this.evt.set();
        }
    }
}
class RedisPipeLine extends Redis{
    protected _$_real:Redis;
    protected _$_casts:any[]=[];
    constructor(realRedis:Redis){
        super(null);
        this._$_real=realRedis;
        this._prefix=realRedis["_prefix"];
    }
    protected beforeSend(){
    }
    protected send(...args) {
        return super.send(...args);
    }
    protected wait(convert?){
        this._$_casts.push(convert);
    }
    public pipeSubmit():any[]{
        if(this._temp_cmds.length<1){
            return [];
        }
        if(this._temp_cmds.length!=this._$_casts.length){
            throw "readis_some_fn_imp_check";
        }
        let r =this._$_real;this._$_real=null;
        return r["pipelineSubmitBridge"](this._temp_cmds, this._$_casts);
    }
    protected pre_trans(){
        throw "redis_in_pipeline";
    }
    protected pre_sub(){
        throw "redis_in_pipeline";
    }
    protected pre_block(){
        throw "redis_in_pipeline";
    }
}

export class RedisError extends Error{
    get name () {
        return this.constructor.name
    }
}
class RespReader {
    private sock:Class_Socket;
    private killed:boolean;
    private handler:{check:(sock:Class_Socket)=>boolean, onClose:()=>void, onErr:(e)=>void, replyError:(s:string)=>void, replyData:(d:any)=>void};
    private EMPTY_BUFFER:Class_Buffer;
    constructor(sock:Class_Socket, handler:{check:(sock:Class_Socket)=>boolean, onClose:()=>void, onErr:(e)=>void, replyError:(s:string)=>void, replyData:(d:any)=>void}) {
        this.sock=sock;
        this.handler=handler;
        this.EMPTY_BUFFER=Buffer.from("");
    }
    public kill(){
        this.killed=true;
    }
    public run(){
        coroutine.start(this.read.bind(this));
    }
    private read(){
        let self=this,handler=self.handler,sock=self.sock,reader=new io.BufferedStream(sock),line:string;
        reader.EOL='\r\n';
        while (!self.killed && handler.check(sock)){
            try{
                line=reader.readLine();
                // console.log("line...",line)
                if(line==null){
                    !self.killed && coroutine.start(handler.onClose);
                    break;
                }
                if(line[0]=='+'){
                    handler.replyData(line.substr(1));
                }else if(line[0]==':'){
                    handler.replyData(Number(line.substr(1)));
                }else if(line[0]=='$'){
                    let raw = self.readBulkStr(reader, Number(line.substr(1)));
                    if(raw===0){
                        !self.killed && coroutine.start(handler.onClose);
                        break;
                    }
                    handler.replyData(raw);
                }else if(line[0]=='*'){
                    let multOpt:{err?:string,lost?:boolean} = {};
                    let arr = self.readMult(reader, Number(line.substr(1)), multOpt);
                    if(multOpt.lost){
                        !self.killed && coroutine.start(handler.onClose);
                        break;
                    }
                    if(multOpt.err){
                        handler.replyError(multOpt.err);
                    }
                    handler.replyData(arr);
                }else if(line[0]=='-'){
                    handler.replyError(line.substr(1));
                }else{
                    console.error("RESP_unknow_protocol",line.length,line);
                }
            }catch (e) {
                if(!self.killed){
                    coroutine.start(()=> {
                        console.error("Redis|on_read", e);
                        handler.onErr(e)
                    });
                }
                break;
            }
        }
    }
    private readMult(reader:Class_BufferedStream,len:number,opt:{err?:string,lost?:boolean}){
        let arr=new Array(len), subLine:string,subRaw,subLine0:string;
        for(var i=0;i<len;i++){
            subLine=reader.readLine();
            // console.log(len,i,subLine.length,subLine)
            if(subLine==null){
                opt.lost=true;
                return opt;
            }
            subLine0=subLine.charAt(0);
            if(subLine0=='$'){
                subRaw=this.readBulkStr(reader, Number(subLine.substr(1)));
                // console.log("subRaw",subRaw)
                if(subRaw===0){
                    opt.lost=true;
                    return opt;
                }
                arr[i]=subRaw;
            }else if(subLine0==':'){
                arr[i]=Number(subLine.substr(1));
            }else if(subLine0=='*'){
                let sub = this.readMult(reader, Number(subLine.substr(1)), opt);
                if(opt.lost){
                    return opt;
                }
                arr[i]=sub;
            }else if(subLine0=='+'){
                arr[i]=subLine.substr(1);
            }else if(subLine0=='-'){
                arr[i]=subLine.substr(1);
                opt.err=arr[i];
            }else{
                console.warn("RESP_UNKNOW_SUB_OPT:"+subLine);
            }
        }
        return arr;
    }
    private readBulkStr(reader:Class_BufferedStream,n:number):any{
        if(n<0){
            return null;
        }
        let b = this.EMPTY_BUFFER;;
        if(n>0){
            b = reader.read(n);
            // console.log("readBulkStr",n,b);
            if(b==null){
                return 0;
            }
            while(b.length<n){
                var t = reader.read(n-b.length);
                if(t==null){
                    return null;
                }
                b=Buffer.concat([b,t]);
            }
        }
        if(reader.readLine()==null){
            return 0;
        }
        return b;
    }
}

function uriToConfig(uri:string):RedisConfig {
    var urlObj=Url.parse(uri);
    var host=urlObj.hostname;
    var port=parseInt(urlObj.port)>0?parseInt(urlObj.port):6379;
    var auth=null;
    if(urlObj.auth.length>0){
        if(urlObj.username.length>0 && urlObj.password.length>0){
            auth=urlObj.username+':'+urlObj.password;
        }else{
            auth=decodeURIComponent(urlObj.auth);
        }
    }
    var timeout=3000;
    var initDb=0;
    var autoReconnect=true;
    if(urlObj.query.length>0){
        var query:any=QueryString.parse(urlObj.query);
        if(query.db && parseInt(query.db)>0 && parseInt(query.db)<=16){
            initDb=parseInt(query.db);
        }
        if(query.auth && query.auth.length>0){
            auth=query.auth;
        }
        if(query.timeout && parseInt(query.timeout)>0){
            timeout=parseInt(query.timeout);
        }
        if(query.autoReconnect){
            var tag=String(query.autoReconnect).toLowerCase();
            autoReconnect=tag!="0"&&tag!="false"&&tag!="no"&&tag!="";
        }
        if(query.prefix){
            this.prefix=String(query.prefix).trim();
        }
    }
    return {db:initDb, timeout:timeout,autoReconnect:autoReconnect, auth:auth, host:host,port:port,};
}
function toArray (hash, array) {
    for (const key of Object.keys(hash)) {
        array.push(key, hash[key])
    }
    return array
}
function toZsetArray (hash, array) {
    for (const key of Object.keys(hash)) {
        array.push(hash[key],key)
    }
    return array
}
function castBool(buf:any):boolean {
    if(util.isBoolean(buf)){
        return buf;
    }
    if(util.isNumber(buf)){
        return buf!=0;
    }
    return buf!=null;
}
function castStr(buf:any):string {
    return buf ? buf.toString():null;
}
function castStrs(bufs):string[] {
    bufs.forEach((v,k,a)=>{
        a[k]=v?v.toString():v;
    });
    return bufs;
}
function deepCastStrs(r:Array<any>){
    if(util.isArray(r)){
        r.forEach((v,k,a)=>{
            if(util.isBuffer(v)){
                a[k] = v.toString();
            }else if(util.isArray(v)){
                a[k] = deepCastStrs(v);
            }
        })
    }
    return r;
}
function castNumber(buf:any):number {
    if(buf){
        if(!util.isNumber(buf)){
            buf=Number(buf.toString());
        }
    }
    return buf;
}
function castNumbers(bufs):number[] {
    bufs.forEach((v, k, a) => {
        if (v != null) {
            var s=v.toString();
            var n = Number(s);
            a[k] = isNaN(n) ? s:n;
        }
    });
    return bufs;
}
function castBigInt(buf:any) {
    if(buf){
        buf=global["BigInt"](buf.toString());
    }
    return buf;
}
function castBigInts(bufs):any[]{
    bufs.forEach((v, k, a) => {
        if (v != null) {
            a[k] = global["BigInt"](v.toString());
        }
    });
    return bufs;
}
function castAuto(a:any):any{
    if(a==null)return a;
    if(util.isNumber(a))return a;
    if(Buffer.isBuffer(a)){
        a=a.toString();
        var n=Number(a);
        if(!isNaN(n)){
            return n;
        }
        return a;
    }
    if(util.isArray(a)){
        a.forEach((iv,ik,ia)=>{
            ia[ik]=castAuto(iv);
        });
    }
    return a;
}

Redis["castAuto"]=castAuto;
Redis["castStr"]=castStr;
Redis["castStrs"]=castStrs;
Redis["castNumber"]=castNumber;
Redis["castNumbers"]=castNumbers;
Redis["castBigInt"]=castBigInt;
Redis["castBigInts"]=castBigInts;
Redis["castBool"]=castBool;

const CODEC = 'utf8';
const CHAR_Star   = Buffer.from('*', CODEC);
const CHAR_Dollar = Buffer.from('$', CODEC);
const BUF_EOL   = Buffer.from('\r\n', CODEC);
function encodeBulk(code):Class_Buffer {
    let buf = Buffer.isBuffer(code) ? code:Buffer.from(String(code), CODEC);
    return Buffer.concat([CHAR_Dollar, Buffer.from(String(buf.length), CODEC), BUF_EOL, buf, BUF_EOL]);
}
export function encodeCommand(command:Array<any>):Class_Buffer {
    let resps = command.map(encodeBulk);
    return Buffer.concat([
        CHAR_Star, Buffer.from(String(resps.length), CODEC), BUF_EOL, ... resps, BUF_EOL
    ]);
}
export function encodeMultCommand(commands:Array<Array<any>>):Class_Buffer {
    return  Buffer.concat([ ... commands.map(encodeOneResp), BUF_EOL ]);
}
function encodeOneResp(command:Array<any>):Class_Buffer {
    let resps = command.map(encodeBulk);
    return Buffer.concat([
        CHAR_Star, Buffer.from(String(resps.length), CODEC), BUF_EOL, ... resps
    ]);
}

const RET_PONG=Buffer.from('pong');
const RET_OK=Buffer.from('OK');

const CmdDump=Buffer.from('dump');
const CmdTouch=Buffer.from('touch');
const CmdMove=Buffer.from('move');
const CmdRandomkey=Buffer.from('randomkey');
const CmdRename=Buffer.from('rename');
const CmdRenameNX=Buffer.from('renamenx');

const CmdPubsub=Buffer.from('pubsub');
const CmdSubscribe=Buffer.from('subscribe');
const CmdPSubscribe=Buffer.from('psubscribe');
const CmdUnSubscribe=Buffer.from('unsubscribe');
const CmdPUnSubscribe=Buffer.from('punsubscribe');
const CmdMessage=Buffer.from('message');
const CmdPMessage=Buffer.from('pmessage');

const CmdQuit=Buffer.from('quit');
const CmdPing=Buffer.from('ping');
const CmdEcho=Buffer.from('echo');
const CmdSwapdb=Buffer.from('swapdb');
const CmdAuth=Buffer.from('auth');
const CmdSelect=Buffer.from('select');
const CmdPublish=Buffer.from('publish');
const CmdExists=Buffer.from('exists');
const CmdKeys=Buffer.from('keys');
const CmdType=Buffer.from('type');
const CmdDel=Buffer.from('del');
const CmdUnlink=Buffer.from('unlink');
const CmdPexpire=Buffer.from('pexpire');
const CmdExpire=Buffer.from('expire');
const CmdPttl=Buffer.from('pttl');
const CmdTtl=Buffer.from('ttl');
const CmdPersist=Buffer.from('persist');
const CmdGet=Buffer.from('get');
const CmdSet=Buffer.from('set');
const CmdOptEX=Buffer.from('EX');
const CmdOptPX=Buffer.from('PX');
const CmdOptNX=Buffer.from('NX');
const CmdOptXX=Buffer.from('XX');
const CmdMSetNX=Buffer.from('msetnx');
const CmdMSet=Buffer.from('mset');
const CmdAppend=Buffer.from('append');
const CmdBitcount=Buffer.from('bitcount');
const CmdBitpos=Buffer.from('bitpos');
const CmdBitop=Buffer.from('bitop');
const CmdGetbit=Buffer.from('getbit');
const CmdSetbit=Buffer.from('setbit');
const CmdSubstr=Buffer.from('substr');
const CmdStrlen=Buffer.from('strlen');
const CmdSetRange=Buffer.from('setrange');
const CmdGetRange=Buffer.from('getrange');
const CmdMGet=Buffer.from('mget');
const CmdGetSet=Buffer.from('getset');
const CmdDecr=Buffer.from('decr');
const CmdIncr=Buffer.from('incr');
const CmdDecrBy=Buffer.from('decrby');
const CmdIncrBy=Buffer.from('incrby');

const CmdLpush=Buffer.from('lpush');
const CmdLpushx=Buffer.from('lpushx');
const CmdRpush=Buffer.from('rpush');
const CmdRpushx=Buffer.from('rpushx');
const CmdLpop=Buffer.from('lpop');
const CmdRpop=Buffer.from('rpop');
const CmdLlen=Buffer.from('llen');
const CmdLindex=Buffer.from('lindex');
const CmdLinsert=Buffer.from('linsert');
const CmdLrange=Buffer.from('lrange');
const CmdLtrim=Buffer.from('ltrim');
const CmdLrem=Buffer.from('lrem');
const CmdLset=Buffer.from('lset');
const CmdBlpop=Buffer.from('blpop');
const CmdBrpop=Buffer.from('brpop');
const CmdBrpopLpush=Buffer.from('brpoplpush');
const CmdRpopLpush=Buffer.from('rpoplpush');

const CmdHSet=Buffer.from('hset');
const CmdHSetNx=Buffer.from('hsetnx');
const CmdHGet=Buffer.from('hget');
const CmdHLen=Buffer.from('hlen');
const CmdHdel=Buffer.from('hdel');
const CmdHKeys=Buffer.from('hkeys');
const CmdHVals=Buffer.from('hvals');
const CmdHGetAll=Buffer.from('hGetAll');
const CmdHExists=Buffer.from('hExists');
const CmdHIncrBy=Buffer.from('hIncrBy');
const CmdHIncrByFloat=Buffer.from('hIncrByFloat');
const CmdHMget=Buffer.from('hmget');
const CmdHMset=Buffer.from('hmset');


const CmdSadd=Buffer.from('sadd');
const CmdSrem=Buffer.from('srem');
const CmdScard=Buffer.from('scard');
const CmdSpop=Buffer.from('spop');
const CmdSrandmember=Buffer.from('srandmember');
const CmdSdiff=Buffer.from('sdiff');
const CmdSdiffStore=Buffer.from('sdiffstore');
const CmdSinter=Buffer.from('sinter');
const CmdSinterStore=Buffer.from('sinterstore');
const CmdSunion=Buffer.from('sunion');
const CmdSunionStore=Buffer.from('sunionstore');
const CmdSismember=Buffer.from('sismember');
const CmdSmembers=Buffer.from('smembers');
const CmdSmove=Buffer.from('smove');

const CmdZadd=Buffer.from('zadd');
const CmdZcard=Buffer.from('zcard');
const CmdZcount=Buffer.from('zcount');
const CmdZlexcount=Buffer.from('zlexcount');
const CmdZincrBy=Buffer.from('zincrby');
const CmdZscore=Buffer.from('zscore');
const CmdZrank=Buffer.from('zrank');
const CmdZrevRank=Buffer.from('zrevrank');
const CmdZrem=Buffer.from('zrem');
const CmdZremRangeByLex=Buffer.from('zremrangebylex');
const CmdZremRangeByScore=Buffer.from('zrangebyscore');
const CmdZremRangeByRank=Buffer.from('zremrangebyrank');
const CmdZpopmax=Buffer.from('zpopmax');
const CmdZpopmin=Buffer.from('zpopmin');
const CmdZrange=Buffer.from('zrange');
const CmdZrevRange=Buffer.from('zrevrange');
const CmdZrangeByScore=Buffer.from('zrangebyscore');
const CmdZrevrangeByScore=Buffer.from('zrevrangebyscore');
const CmdZrangeByLex=Buffer.from('zrangebylex');
const CmdZrevrangeByLex=Buffer.from('zremrangebylex');
const CmdBzPopMin=Buffer.from('bzpopmin');
const CmdBzPopMax=Buffer.from('bzpopmax');

const CmdWatch=Buffer.from('watch');
const CmdUnWatch=Buffer.from('unwatch');
const CmdMulti=Buffer.from('multi');
const CmdExec=Buffer.from('exec');

const CmdPfcount=Buffer.from('pfcount');
const CmdPfadd=Buffer.from('pfadd');
const CmdPfmerge=Buffer.from('pfmerge');

const CmdTime=Buffer.from('time');
const CmdInfo=Buffer.from('info');
const CmdClient=Buffer.from('client');
const CmdSlowlog=Buffer.from('slowlog');
const CmdConfig=Buffer.from('config');
// const CmdShutdown=Buffer.from('shutdown');
// const CmdBgsave=Buffer.from('bgsave');