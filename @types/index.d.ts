/// <reference types="@fibjs/types" />
/**
 * 使用fibjs实现的Redis客户端。
 * 支持 pipeline、mult/exec、pub/sub、以及redis4.0的api。
 * 使用注意：以下情况禁止使用公共的Redis对象
 *   1. block系列api（blpop...）会阻塞
 *   2. mult/exec 这个api开启后其他Fiber调用命令也会乱入
 *   3. sub系列  开启(p)subscribe后禁用大多数api方法了
 */
export class Redis {
        public bufSize:number;//socket读取数据recv大小，默认255
        public waitReconnect;//发送指令时,如果在重连中是否等待重连，默认true
        //  redis://127.0.0.1:6379   redis://authkey@127.0.0.1:6379?db=1&timeout=3000&autoReconnect=true
        constructor(url:string/*="redis://127.0.0.1:6379"*/, autoReconnect?:boolean/*=true*/);

        public command(cmd:string,...args):any;

        public pipeOpen():Redis;//开启命令缓存-仅针对当前Fiber调用(开启后未提交时不影响其他Fiber使用)
        public pipeSubmit(throwIfHappenErr?:boolean):Array<any>;//提交命令缓存
        public multi():Redis;//开启事物
        public exec():Array<any>;//提交事物

        public watch(...keys):boolean;
        public unwatch():boolean;
        public auth(requirepass:string):boolean;
        public select(db:number):boolean;
        public ping():boolean;
        public publish(channel:string|Class_Buffer, data:string|number|Class_Buffer):number;

        public exists(key:string|Class_Buffer):boolean;
        public type(key:string|Class_Buffer):string;
        public keys(pattern:string|Class_Buffer):Array<string>;
        public rename(key:string|Class_Buffer,newkey:string|Class_Buffer):boolean;
        public renameNX(key:string|Class_Buffer,newkey:string|Class_Buffer):boolean;

        public del(...keys):number;
        public unlink(...keys):number;

        public expire(key:string|Class_Buffer, secondTtl:number):boolean;
        public pexpire(key:string|Class_Buffer, millonSecondTtl:number):boolean;

        public ttl(key:string|Class_Buffer):number;
        public pttl(key:string|Class_Buffer):number;
        public persist(key:string|Class_Buffer):boolean;
        public set(key:string|Class_Buffer, val:any, ttlSecond?:number/*=0*/):boolean;
        public add(key:string|Class_Buffer, val:any, ttlSecond?:number/*=0*/):boolean;
        public setNX(key:string|Class_Buffer, val:any, ttlSecond?:number/*=0*/):boolean;
        public setXX(key:string|Class_Buffer, val:any, ttlSecond?:number/*=0*/):boolean;

        public mset(...kvs):boolean;
        public msetNX(...kvs):boolean;
        public append(key:string|Class_Buffer, val:any):boolean;
        public setRange(key:string|Class_Buffer, offset:number, val:any):boolean;
        public getRange(key:string|Class_Buffer, start:number, end:number, parseFn?:Function):string|Class_Buffer;

        public strlen(key:string|Class_Buffer):number;
        public bitcount(key:string|Class_Buffer):number;
        public get(key:string|Class_Buffer, parseFn?:Function):string|number|Class_Buffer|null;
        public mget(keys:Array<string>, parseFn?:Function):Array<string>;
        public getSet(key:string|Class_Buffer, val:any, parseFn?:Function):string|number|Class_Buffer|null;

        public incr(key:string|Class_Buffer, parseFn?:Function):any;
        public decr(key:string|Class_Buffer, parseFn?:Function):any;
        public incrBy(key:string|Class_Buffer, step:number, parseFn?:Function):any;
        public decrBy(key:string|Class_Buffer, step:number, parseFn?:Function):any;

        public setBit(key:string|Class_Buffer, offset:number, val:number):boolean;
        public getBit(key:string|Class_Buffer, offset:number):number;

        public scan(cursor:any, matchPattern?:string|Class_Buffer, matchCount?:number, parseFn?:Function):Array<any>&{currsor:number, list:Array<any>};
        public sscan(key:string|Class_Buffer, cursor:any, matchPattern?:string|Class_Buffer, matchCount?:number, parseFn?:Function):Array<any>&{currsor:number, list:Array<any>};
        public hscan(key:string|Class_Buffer, cursor:any, matchPattern?:string|Class_Buffer, matchCount?:number, parseFn?:Function):Array<any>&{currsor:number, list:Array<any>};
        public zscan(key:string|Class_Buffer, cursor:any, matchPattern?:string|Class_Buffer, matchCount?:number, parseFn?:Function):Array<any>&{currsor:number, list:Array<any>};

        public geoadd(key:string|Class_Buffer, ...LngLatMembers):number;
        public geodist(key:string|Class_Buffer, m1:any, m2:any, unit?:string):number;
        public geohash(key:string|Class_Buffer, ...members):Array<string>;
        public geopos(key:string|Class_Buffer, ...members):Array<number>;
        public georadius(key:string|Class_Buffer, longitude:string|number, latitude:string|number, radius:string|number, unit:string, withOpts?:Array<string>):Array<any>;
        public georadiusbymember(key:string|Class_Buffer, member:any, radius:string|number, unit:string):Array<string>;

        public lPush(key:string|Class_Buffer, val:any):number;
        public rPush(key:string|Class_Buffer, val:any):number;
        public lPushx(key:string|Class_Buffer, val:any):number;
        public rPushx(key:string|Class_Buffer, val:any):number;
        public lLen(key:string|Class_Buffer):number;
        public lPop(key:string|Class_Buffer, parseFn?:Function):string|number|Class_Buffer|null;
        public rPop(key:string|Class_Buffer, parseFn?:Function):string|number|Class_Buffer|null;
        public lIndex(key:string|Class_Buffer, offset:number, parseFn?:Function):string|number|Class_Buffer|null;
        public lInsert(key:string|Class_Buffer, pivot:any, val:any, toBefore?:boolean/*=true*/):number;
        public lSet(key:string|Class_Buffer, index:number, val:any):boolean;
        public lRem(key:string|Class_Buffer, count:number, val:any):number;
        public lTrim(key:string|Class_Buffer, start:number, stop:number):boolean;
        public lRange(key:string|Class_Buffer, start:number, stop:number, parseFn?:Function):Array<string|number|Class_Buffer|null>;
        public bLpop(key:any, timeout:number, parseFn?:Function):string|number|Class_Buffer|null;
        public bRpop(key:any, timeout:number, parseFn?:Function):string|number|Class_Buffer|null;
        public bRpopLpush(srcKey:string|Class_Buffer, destKey:string|Class_Buffer, timeout:number, parseFn?:Function):string|number|Class_Buffer|null;
        public rPopLpush(srcKey:string|Class_Buffer, destKey:string|Class_Buffer, parseFn?:Function):string|number|Class_Buffer|null;

        public sAdd(key:string|Class_Buffer, ...members):number;
        public sRem(key:string|Class_Buffer, ...members):number;
        public sCard(key:string|Class_Buffer):number;
        public sPop(key:string|Class_Buffer, num?:number/*=1*/, parseFn?:Function):Array<string|number|Class_Buffer|null>;
        public sRandmember(key:string|Class_Buffer, num?:number/*=1*/, parseFn?:Function):Array<string|number|Class_Buffer|null>;
        public sIsmember(key:string|Class_Buffer, member:any):boolean;
        public sDiff(keys:Array<string|Class_Buffer>, castFn?:Function):Array<string|number|Class_Buffer|null>;
        public sDiffStore(destKey:string|Class_Buffer, ...keys):number;
        public sInter(keys:Array<string|Class_Buffer>, castFn?:Function):Array<string|number|Class_Buffer|null>;
        public sInterStore(key:string|Class_Buffer, ...keys):number;
        public sUnion(keys:Array<string|Class_Buffer>, castFn?:Function):Array<string|number|Class_Buffer|null>;
        public sUnionStore(destKey:string|Class_Buffer, ...keys):number;
        public sMembers(keys:Array<string|Class_Buffer>, castFn?:Function):Array<string|number|Class_Buffer|null>;
        public sMove(sourceKey:string|Class_Buffer, destKey:string|Class_Buffer, member:any):number;

        public zAdd(key:string|Class_Buffer, sms:{[index:string]:number}|Array<any>, opts?:Array<string>):number;
        public zCard(key:string|Class_Buffer):number;
        public zCount(key:string|Class_Buffer, min:string|number, max:string|number):number;
        public zLexCount(key:string|Class_Buffer, min:string|number, max:string|number):number;
        public zIncrBy(key:string|Class_Buffer, member:any, increment:number):number;
        public zScore(key:string|Class_Buffer, member:any):number;
        public zRank(key:string|Class_Buffer, member:any):number;
        public zRem(key:string|Class_Buffer, ...members):number;
        public zRemByLex(key:string|Class_Buffer, min:string|number, max:string|number):number;
        public zRemByScore(key:string|Class_Buffer, min:string|number, max:string|number):number;
        public zRemByRank(key:string|Class_Buffer, start:number, stop:number):number;

        public zPopMin(key:string|Class_Buffer, castFn?:Function):Array<{member:string,score:number}>;
        public zPopMax(key:string|Class_Buffer, castFn?:Function):Array<{member:string,score:number}>;
        public zRange(key:string|Class_Buffer, start:number, stop:number, castFn?:Function):Array<string|number|Class_Buffer>;
        public zRangeWithscore(key:string|Class_Buffer, start:number, stop:number, castFn?:Function):Array<{member:string|number,score:number}>;
        public zRevRange(key:string|Class_Buffer, start:number, stop:number, castFn?:Function):Array<string|number|Class_Buffer>;
        public zRevRangeWithscore(key:string|Class_Buffer, start:number, stop:number, castFn?:Function):Array<{member:string|number,score:number}>;

        public zRangeByScore(key:string|Class_Buffer, min:number, max:number, opts?:{withScore?:boolean, limit?:{offset:number,count:number}}/*={withScore:false}*/, castFn?:Function):Array<any>;
        public zRevRangeByScore(key:string|Class_Buffer, min:number, max:number, opts?:{withScore?:boolean, limit?:{offset:number,count:number}}/*={withScore:false}*/, castFn?:Function):Array<any>;

        public bzPopMin(key:any, timeout?:number/*=0*/, castFn?:Function):string|number|Class_Buffer|null;
        public bzPopMax(key:any, timeout?:number/*=0*/, castFn?:Function):string|number|Class_Buffer|null;

        public subscribe(key:string|string[], fn:(msg:Class_Buffer, channel?:string)=>void);
        public psubscribe(key:string|string[], fn:(msg:Class_Buffer, channel?:string)=>void);
        public unsubscribe(key:string, fn:Function);
        public punsubscribe(key:string, fn:Function);
        public unsubscribeAll(key:string);
        public punsubscribeAll(key:string);

        public static castBool:Function;
        public static castStr:Function;
        public static castStrs:Function;
        public static castNumber:Function;
        public static castNumbers:Function;
        public static castBigInt:Function;
        public static castAuto:Function;
    }