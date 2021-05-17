/// <reference types="@fibjs/types" />
/**
 * redis-客户端类
 */
import { EventEmitter } from "events";
export interface RedisConfig {
    host: string;
    port: number;
    auth?: string;
    db: number;
    timeout: number;
    autoReconnect: boolean;
    prefix?: string;
}
/**
 * 相关事件
 */
export declare let RedisEvent: {
    onOpen: string;
    onLost: string;
    onClose: string;
};
/**RedisError
 * Redis client
 * "redis://127.0.0.1:6379"
 * "redis://authpwd@127.0.0.1:6379?db=1&prefix=XX:"
 * "redis://127.0.0.1:6379?db=1&prefix=XX:&auth=authpwd"
 */
export declare class Redis extends EventEmitter {
    protected _waitReconnect: boolean;
    protected _prefix: {
        str: string;
        buf: Class_Buffer;
    };
    private _opts;
    private _sender;
    private _reader;
    private _socket;
    private _onOpen;
    private _connectLock;
    private _state;
    private _reconIng;
    private _killed;
    private _backs;
    private _mult_backs;
    private _subFn;
    private _psubFn;
    private _sub_backs;
    private _sendBufs;
    private _sendEvt;
    /**
     *
     * @param conf 配置
     * @param openConnType 构造函数中打开接方式：0-不进行连接，1-当前fiber连接，2-新fiber连接
     */
    constructor(conf?: RedisConfig | string, openConnType?: 0 | 1 | 2);
    connect(): this;
    /**
     * 发送指令时,如果在重连中是否等待重连【默认为true】，需要配合配置【autoReconnect】一同生效
     */
    get waitReconnect(): boolean;
    set waitReconnect(b: boolean);
    /**
     * 所有发送key的前缀
     */
    get prefix(): string;
    set prefix(s: string);
    private _do_conn;
    private _pre_Fibers;
    private _pre_command;
    private _on_lost;
    private _on_err;
    private _try_drop_cbks;
    private _try_drop_worker;
    private _try_auto_reconn;
    close(): void;
    protected _is_in_pipeline(): boolean;
    protected _before_send(): void;
    protected _temp_cmds: Class_Buffer[];
    protected _tmp_send(...args: any[]): this;
    protected _wait(convert?: any): any;
    rawCommand(cmd: string, ...args: any[]): any;
    ping(): string;
    quit(): boolean;
    echo(s: string): string;
    eval(script: any, keys: any[], args?: any[], castFn?: typeof castAuto): any;
    eval2(script: any, keysNum: number, ...keys_args: any[]): any;
    evalsha(sha1: any, keys: any[], args?: any[], castFn?: typeof castAuto): any;
    evalsha2(sha1: any, keysNum: number, ...keys_args: any[]): any;
    scriptLoad(script: any): string;
    scriptExists(...sha1s: any[]): boolean[];
    scriptFlush(): boolean;
    scriptKill(): boolean;
    scriptDebug(type: "YES" | "SYNC" | "NO"): boolean;
    swapdb(a: number, b: number): boolean;
    select(db: number): boolean;
    info(option?: string): string;
    client(subCommand: string, ...args: any[]): string;
    time(): number[];
    slowlog(subCommand: any, ...subArgs: any[]): any;
    slowlogLen(): any;
    slowlogGet(n: number): any;
    config(subCommand: any, ...subArgs: any[]): any;
    protected _pre_trans(): void;
    watch(...keys: any[]): boolean;
    unwatch(): boolean;
    multi(): Redis;
    exec(): any[];
    discard(): boolean;
    protected _assert_normal(): void;
    pipeline(fn: (r: Redis) => void): any[];
    pipeOpen(): Redis;
    pipeSubmit(): any[];
    private _pipeline_submit_bridge;
    keys(pattern: string | Class_Buffer): string[];
    exists(key: string | Class_Buffer): boolean;
    type(key: string | Class_Buffer): string;
    rename(key: string | Class_Buffer, newkey: string | Class_Buffer): boolean;
    renameNX(key: string | Class_Buffer, newkey: string | Class_Buffer): boolean;
    dump(key: string | Class_Buffer): string;
    touch(...keys: any[]): number;
    move(key: string | Class_Buffer, toDb: number): number;
    randomKey(): string;
    del(...keys: any[]): number;
    unlink(...keys: any[]): number;
    expire(key: string | Class_Buffer, ttl: number): boolean;
    pexpire(key: string | Class_Buffer, ttl: number): boolean;
    pttl(key: string | Class_Buffer): number;
    ttl(key: string | Class_Buffer): number;
    persist(key: string | Class_Buffer): boolean;
    set(key: string | Class_Buffer, val: any, ttl?: number): boolean;
    add(key: string | Class_Buffer, val: any, ttl?: number): boolean;
    setNX(key: string | Class_Buffer, val: any, ttl?: number): boolean;
    setXX(key: string | Class_Buffer, val: any, ttl?: number): boolean;
    mset(...kvs: any[]): boolean;
    msetNX(...kvs: any[]): boolean;
    append(key: string | Class_Buffer, val: string | Class_Buffer): boolean;
    setRange(key: string | Class_Buffer, offset: number, val: string | Class_Buffer): number;
    getRange(key: string | Class_Buffer, start: number, end: number, castFn?: Function): string;
    substr(key: string | Class_Buffer, start: number, end: number, castFn?: Function): string | Class_Buffer;
    strlen(key: string | Class_Buffer): number;
    get(key: string | Class_Buffer, castFn?: Function): any;
    mget(keys: string[], castFn?: Function): any[];
    mgetWrap(keys: string[], castFn?: Function): {
        [index: string]: any;
    };
    mgetWrap2(keys: any[], fixKeyPathFn: (k: any) => string, castFn?: Function): {
        [index: string]: any;
    };
    getSet(key: string | Class_Buffer, val: any, castFn?: Function): any;
    incr(key: string | Class_Buffer, castFn?: Function): number;
    decr(key: string | Class_Buffer, castFn?: Function): number;
    incrByFloat(key: string | Class_Buffer, step: number, castFn?: Function): number;
    incrBy(key: string | Class_Buffer, step: number, castFn?: Function): number;
    decrBy(key: string | Class_Buffer, step: number, castFn?: Function): number;
    bitCount(key: string | Class_Buffer): number;
    bitPos(key: string | Class_Buffer, start: number, end?: number): number;
    bitOp(option: 'AND' | 'OR' | 'NOT' | 'XOR', destkey: string | Class_Buffer, ...keys: any[]): number;
    setBit(key: string | Class_Buffer, offset: number, val: number): boolean;
    getBit(key: string | Class_Buffer, offset: number): number;
    private _scan_act;
    scan(cursor: any, matchPattern?: string | Class_Buffer, matchCount?: number, castFn?: Function): any[];
    sscan(key: string | Class_Buffer, cursor: any, matchPattern?: string | Class_Buffer, matchCount?: number, castFn?: Function): any[];
    hscan(key: string | Class_Buffer, cursor: any, matchPattern?: string | Class_Buffer, matchCount?: number, castFn?: Function): any[];
    zscan(key: string | Class_Buffer, cursor: any, matchPattern?: string | Class_Buffer, matchCount?: number, castFn?: Function): any[];
    geoadd(key: string | Class_Buffer, ...LngLatMembers: any[]): number;
    geodist(key: string | Class_Buffer, m1: any, m2: any, unit?: string): number;
    geohash(key: string | Class_Buffer, ...members: any[]): string[];
    geopos(key: string | Class_Buffer, ...members: any[]): any;
    georadius(key: string | Class_Buffer, longitude: string | number, latitude: string | number, radius: string | number, unit: string, withOpts?: Array<string>): any;
    georadiusbymember(key: string | Class_Buffer, member: any, radius: string | number, unit: string): string[];
    protected _pre_block(): void;
    lPush(key: string | Class_Buffer, ...vals: any[]): number;
    rPush(key: string | Class_Buffer, ...vals: any[]): number;
    lPushx(key: string | Class_Buffer, val: any): number;
    rPushx(key: string | Class_Buffer, val: any): number;
    lLen(key: string | Class_Buffer): number;
    lPop(key: string | Class_Buffer, castFn?: Function): any;
    rPop(key: string | Class_Buffer, castFn?: Function): any;
    lIndex(key: string | Class_Buffer, offset: number, castFn?: Function): any;
    lInsert(key: string | Class_Buffer, pivot: any, val: any, toBefore?: boolean): number;
    lSet(key: string | Class_Buffer, index: number, val: any): boolean;
    lRem(key: string | Class_Buffer, count: number, val: any): number;
    lTrim(key: string | Class_Buffer, start: number, stop: number): number;
    lRange(key: string | Class_Buffer, start: number, stop: number, castFn?: Function): any[];
    bLpop(key: string | Class_Buffer | Array<string | Class_Buffer>, timeout: number, castFn?: Function): any[];
    bRpop(key: string | Class_Buffer | Array<string | Class_Buffer>, timeout: number, castFn?: Function): any[];
    bRpopLpush(srcKey: string | Class_Buffer, destKey: string | Class_Buffer, timeout: number, castFn?: Function): any;
    rPopLpush(srcKey: string | Class_Buffer, destKey: string | Class_Buffer, castFn?: Function): any;
    hSet(key: string | Class_Buffer, field: string | Class_Buffer | number, val: any): number;
    hSetNx(key: string | Class_Buffer, field: string | Class_Buffer | number, val: any): number;
    hGet(key: string | Class_Buffer, field: string | Class_Buffer | number, castFn?: Function): any;
    hLen(key: string | Class_Buffer): number;
    hDel(key: string | Class_Buffer, ...fields: any[]): number;
    hKeys(key: string | Class_Buffer, castFn?: Function): any[];
    hVals(key: string | Class_Buffer, castFn?: Function): any[];
    hGetAll(key: string | Class_Buffer, castFn?: Function): any[];
    hGetAllWrap(key: string | Class_Buffer, castFn?: Function): {
        [index: string]: any;
    };
    hExists(key: string | Class_Buffer, field: string | Class_Buffer | number): boolean;
    hIncrBy(key: string | Class_Buffer, field: string | Class_Buffer | number, val: number | string | {
        toString(): string;
    }, castFn?: Function): any;
    hIncrByFloat(key: string | Class_Buffer, field: string | Class_Buffer | number, val: number | string | {
        toString(): string;
    }): number;
    hMset(key: string | Class_Buffer, hashObj: {
        [index: string]: any;
    }): boolean;
    hMGet(key: string | Class_Buffer, fields: Array<string | Class_Buffer | number>, castFn?: Function): any[];
    hMGetWrap(key: string | Class_Buffer, fields: Array<string | Class_Buffer | number>, castFn?: Function): {
        [index: string]: any;
    };
    sAdd(key: string | Class_Buffer, ...members: any[]): number;
    sRem(key: string | Class_Buffer, ...members: any[]): number;
    sCard(key: string | Class_Buffer): number;
    sPop(key: string | Class_Buffer, num?: number, castFn?: Function): any[];
    sPopOne(key: string | Class_Buffer, castFn?: Function): string | number | any;
    sRandMember(key: string | Class_Buffer, num?: number, castFn?: Function): any[];
    sIsMember(key: string | Class_Buffer, member: any): boolean;
    sDiff(keys: Array<string | Class_Buffer>, castFn?: Function): any[];
    sDiffStore(destKey: string | Class_Buffer, keys: Array<string | Class_Buffer>): number;
    sInter(keys: Array<string | Class_Buffer>, castFn?: Function): any[];
    sInterStore(destKey: string | Class_Buffer, keys: Array<string | Class_Buffer>): number;
    sUnion(keys: Array<string | Class_Buffer>, castFn?: Function): any[];
    sUnionStore(destKey: string | Class_Buffer, keys: Array<string | Class_Buffer>): number;
    sMembers(key: string | Class_Buffer, castFn?: Function): any[];
    sMove(sourceKey: string | Class_Buffer, destKey: string | Class_Buffer, member: any): number;
    zAdd(key: string | Class_Buffer, opts: string[], ...score2members: any[]): number;
    zAddByKV(key: string | Class_Buffer, sms: {
        [index: string]: number;
    }, opts?: Array<string>): number;
    zAddOne(key: string | Class_Buffer, member: any, score: number, opts?: Array<string>): number;
    zIncrBy(key: string | Class_Buffer, member: any, increment: number, castFn?: Function): number | any;
    zCard(key: string | Class_Buffer): number;
    zCount(key: string | Class_Buffer, min: string | number, max: string | number): number;
    zLexCount(key: string | Class_Buffer, min: string | number, max: string | number): number;
    zScore(key: string | Class_Buffer, member: any, castFn?: typeof castNumber): number;
    zRank(key: string | Class_Buffer, member: any): number;
    zRevRank(key: string | Class_Buffer, member: any): number;
    zRem(key: string | Class_Buffer, ...members: any[]): number;
    zRemByLex(key: string | Class_Buffer, min: string | number, max: string | number): number;
    zRemByScore(key: string | Class_Buffer, min: string | number, max: string | number): number;
    zRemByRank(key: string | Class_Buffer, start: number, stop: number): number;
    private _z_act;
    zRange(key: string | Class_Buffer, start: number, stop: number, castFn?: Function): any[];
    zRangeWithscore(key: string | Class_Buffer, start: number, stop: number, castFn?: Function): Array<{
        member: string | number;
        score: number;
    }>;
    zRevRange(key: string | Class_Buffer, start: number, stop: number, castFn?: Function): any[];
    zRevRangeWithscore(key: string | Class_Buffer, start: number, stop: number, castFn?: Function): Array<{
        member: string | number;
        score: number;
    }>;
    zRangeByScore(key: string | Class_Buffer, min: number, max: number, opts?: {
        withScore?: boolean;
        limit?: {
            offset: number;
            count: number;
        };
    }, castFn?: Function): any[];
    zRevRangeByScore(key: string | Class_Buffer, min: number, max: number, opts?: {
        withScore?: boolean;
        limit?: {
            offset: number;
            count: number;
        };
    }, castFn?: Function): any[];
    zPopMin(key: string | Class_Buffer, num?: number, castFn?: Function): Array<{
        member: string | number;
        score: number;
    }>;
    zPopMax(key: string | Class_Buffer, num?: number, castFn?: Function): Array<{
        member: string | number;
        score: number;
    }>;
    bzPopMin(key: string | Class_Buffer | Array<string | Class_Buffer>, timeout?: number, castFn?: Function): Array<string | number>;
    bzPopMax(key: string | Class_Buffer | Array<string | Class_Buffer>, timeout?: number, castFn?: Function): Array<string | number>;
    zUnionStore(destKey: string | Class_Buffer, numkeys: number, srcKeys: string | Class_Buffer | Array<string | Class_Buffer>, weights?: Array<number>): number;
    zInterStore(destKey: string | Class_Buffer, numkeys: number, srcKeys: string | Class_Buffer | Array<string | Class_Buffer>, weights?: Array<number>): number;
    pfAdd(key: string | Class_Buffer, ...elements: any[]): number;
    pfCount(key: string | Class_Buffer): number;
    pfMerge(destKey: string | Class_Buffer, ...sourceKeys: any[]): boolean;
    publish(channel: string | Class_Buffer, data: any): number;
    pubsub(subCmd: string | Class_Buffer, ...args: any[]): string[] | number;
    pubsubChannels(): string[];
    pubsubNumSub(...channels: any[]): {
        [index: string]: number;
    };
    pubsubNumPat(): number;
    private _real_sub;
    subscribe(key: string | string[], fn: (d: Class_Buffer, chan?: string) => void): number;
    psubscribe(key: string | string[], fn: (d: Class_Buffer, chan?: string) => void): number;
    private _real_unsub;
    unsubscribe(key: string, fn: Function): number;
    punsubscribe(key: string, fn: Function): number;
    unsubscribeAll(key: string): void;
    punsubscribeAll(key: string): void;
    protected _pre_sub(): void;
    private _after_unsub;
    private _pre_sub_onConnect;
    private _on_subReply;
    xlen(key: string): number;
    xAdd(key: string, idOption: string | number, ...kvs: any[]): string;
    xDel(key: string, ...ids: any[]): number;
    xRange(key: string, start: string | number, end: string | number, countLimit?: number): Array<any>;
    xRangeWrap(key: string, start: string | number, end: string | number, countLimit?: number): Array<{
        id: string;
        items: Array<{
            k: string;
            v: string;
        }>;
    }>;
    xRevRange(key: string, start: string | number, end: string | number, countLimit?: number): Array<any>;
    xRevRangeWrap(key: string, start: string | number, end: string | number, countLimit?: number): Array<{
        id: string;
        items: Array<{
            k: string;
            v: string;
        }>;
    }>;
    private _xRangeRspWrap;
    xTrimMaxlen(key: string, count: number, fast?: boolean): any;
    xInfoGroups(key: string): Array<{
        [index: string]: number;
    }>;
    xInfoConsumers(key: string, group: string): Array<{
        [index: string]: number;
    }>;
    xInfoStream(key: string): {
        [index: string]: number | {
            id: string;
            k: string;
            v: string;
        };
    };
    xGroupCreate(key: string, group: string, id: string | number): any;
    xGroupDestroy(key: string, group: string): any;
    xGroupDelconsumer(key: string, group: string, consumer: string): any;
    xGroupSetid(key: string, group: string, id: string | number): any;
    xReadGroup(group: string, consumer: string, streamOptions: {
        [index: string]: string | number;
    }, count?: number): any[];
    xRead(streamKeys: string[], ids?: any[], count?: number): any[];
    xAck(key: string, ...ids: any[]): number;
    xPending(key: string, group: string, limit?: {
        start: string | number;
        end: string | number;
        count: number;
    }, consumer?: string): Array<any>;
    xClaim(key: string, group: string, consumer: string, minIdelTimes: number, ids: string[], options?: any): any;
    private _fix_prefix_str;
    private _fix_prefix_any;
    static castBool: (bufs: any) => boolean;
    static castBools: (bufs: any) => boolean[];
    static castAuto: (bufs: any) => any;
    static castStr: (bufs: any) => string;
    static castStrs: (bufs: any) => string[];
    static castNumber: (bufs: any) => number;
    static castNumbers: (bufs: any) => number[];
    static castBigInt: (bufs: any) => any;
    static castBigInts: (bufs: any) => any[];
    static castJSON: (bufs: any) => any;
    static castDate: (bufs: any) => Date;
}
export declare class RedisError extends Error {
    get name(): string;
}
declare function castNumber(buf: any): number;
declare function castAuto(a: any): any;
export declare function encodeCommand(command: Array<any>): Class_Buffer;
export declare function encodeMultCommand(commands: Array<Array<any>>): Class_Buffer;
export {};
