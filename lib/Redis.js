"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/// <reference types="@fibjs/types" />
const redis_errors_1 = require("redis-errors");
const RedisParser = require("redis-parser");
const net = require("net");
const io = require("io");
const Url = require("url");
const QueryString = require("querystring");
const coroutine = require("coroutine");
const util = require("util");
/**
 * Redis client
 */
class Redis {
    constructor(url = "redis://127.0.0.1:6379") {
        this.bufSize = 255; //socket读取数据recv大小
        this.waitReconnect = true; //发送指令时,如果在重连中是否等待重连
        this.temp_cmds = [];
        var urlObj = Url.parse(url);
        var host = urlObj.hostname;
        var port = parseInt(urlObj.port) > 0 ? parseInt(urlObj.port) : 6379;
        var auth = urlObj.auth.length > 0 ? urlObj.auth : null;
        var timeout = 3000;
        var initDb = 0;
        var autoReconnect = true;
        if (urlObj.query.length > 0) {
            var query = QueryString.parse(urlObj.query);
            if (query.db && parseInt(query.db) > 0 && parseInt(query.db) <= 16) {
                initDb = parseInt(query.db);
            }
            if (query.auth && !auth) {
                auth = query.auth;
            }
            if (query.timeout && parseInt(query.timeout) > 0) {
                timeout = parseInt(query.timeout);
            }
            if (query.autoReconnect) {
                var tag = String(query.autoReconnect).toLowerCase();
                autoReconnect = tag != "0" && tag != "false" && tag != "no" && tag != "";
            }
        }
        this.opts = { db: initDb, timeout: timeout, autoReconnect: autoReconnect, auth: auth, host: host, port: port, };
        this.onOpen = new coroutine.Event(false);
        this.do_conn();
    }
    do_conn() {
        let opts = this.opts;
        var sock = new net.Socket();
        sock.timeout = opts.timeout;
        sock.connect(opts.host, opts.port);
        var buf = new io.BufferedStream(sock);
        buf.EOL = "\r\n";
        opts.auth && this.pre_command(sock, buf, 'auth', opts.auth);
        opts.db > 0 && this.pre_command(sock, buf, 'select', opts.db);
        this.socket = sock;
        // this.stream=buf;
        this.backs = [];
        this.connected = true;
        let self = this;
        self.parser = new RedisParser({
            returnBuffers: true,
            optionStringNumbers: true,
            returnReply: reply => {
                // console.log("--->>>",reply.toString())
                if (self.sub_backs) {
                    self.on_subReply(reply);
                }
                else {
                    self.backs.shift().then(reply);
                }
            },
            returnError: error => {
                if (self.sub_backs) {
                    self.sub_backs.shift().fail(error);
                }
                else {
                    self.backs.shift().fail(error);
                }
            }
        });
        sock.timeout = -1;
        self.reader = coroutine.start(function () {
            var buf = null;
            var sock = self.socket;
            while (self.connected) {
                try {
                    buf = sock.recv(self.bufSize);
                    if (buf == null) {
                        self.on_lost();
                        break;
                    }
                    self.parser.execute(buf);
                }
                catch (e) {
                    if (!self.killed) {
                        console.error("xredis.on_read", e);
                        self.on_err(e);
                    }
                    break;
                }
            }
        });
        this.pre_sub_onConnect();
        self.onOpen.set();
    }
    pre_command(sock, buf, ...args) {
        // buf.write(commandToResp(args));
        buf.write(encodeCommand(args));
        var str = buf.readLine();
        if (str == null) {
            sock.close();
            throw new redis_errors_1.RedisError("io-err");
        }
        if (str.indexOf("invalid") > 0) {
            sock.close();
            throw new redis_errors_1.RedisError("ERR invalid password");
        }
    }
    on_lost() {
        this.on_err(new Error("io_error"), true);
    }
    on_err(e, deadErr) {
        if (this.socket == null) {
            return;
        }
        try {
            this.socket.close();
        }
        catch (e) {
        }
        this.connected = false;
        this.onOpen.clear();
        var backs = this.backs;
        this.backs = [];
        backs.forEach(operation => {
            operation.fail(e);
        });
        backs = this.sub_backs;
        this.sub_backs = null;
        if (backs) {
            backs.forEach(operation => {
                operation.fail(e);
            });
        }
        this.mult_backs = null;
        if (this.opts.autoReconnect && !this.killed) {
            var i = 0;
            while (!this.connected && !this.killed) {
                try {
                    this.do_conn();
                    break;
                }
                catch (e) {
                    console.error(this.opts.host + ":" + this.opts.port, e);
                }
                i++;
                coroutine.sleep(Math.min(i * 5, 500));
            }
        }
    }
    close() {
        this.killed = true;
        this.connected = false;
        var sock = this.socket;
        this.socket = null;
        try {
            sock.close();
        }
        catch (e) {
        }
        var backs = this.backs;
        this.backs = [];
        var e = new Error("io_close");
        backs.forEach(operation => {
            operation.fail(e);
        });
    }
    send(...args) {
        if (this.pipe_caches) {
            this.pipe_caches.push(encodeCommand(args));
        }
        else {
            if (this.killed) {
                throw new redis_errors_1.RedisError("io_had_closed");
            }
            if (!this.connected && this.opts.autoReconnect) {
                if (this.waitReconnect) {
                    this.onOpen.wait(); //等待重连
                }
            }
            if (!this.socket || !this.connected) {
                throw new redis_errors_1.RedisError("io_error");
            }
            this.temp_cmds.push(encodeCommand(args));
        }
        return this;
    }
    wait(convert) {
        if (this.pipe_caches) {
            this.pipe_casts.push(convert);
            return this;
        }
        var backs = this.backs;
        if (this.sub_backs) {
            backs = this.sub_backs;
        }
        else if (this.mult_backs) {
            this.mult_backs.push(convert);
            convert = castStr;
        }
        var evt = new OptEvent();
        backs.push(evt);
        try {
            this.socket.send(this.temp_cmds.length == 1 ? this.temp_cmds[0] : Buffer.concat(this.temp_cmds));
            this.temp_cmds.length = 0;
        }
        catch (e) {
            this.temp_cmds.length = 0;
            this.on_err(e, true);
            throw e;
        }
        return evt.wait(convert);
    }
    command(cmd, ...args) {
        // console.log("...>",cmd,...args);
        return this.send(...arguments).wait();
    }
    ping() {
        return this.send(CmdPing).wait(castStr);
    }
    select(db) {
        return this.send(CmdSelect).wait(castBool);
    }
    watch(...keys) {
        keys = util.isArray(keys[0]) ? keys[0] : keys;
        return this.send(CmdWatch, ...keys).wait(castBool);
    }
    unwatch() {
        return this.send(CmdUnWatch).wait(castBool);
    }
    multi() {
        if (this.sub_backs) {
            throw new redis_errors_1.RedisError("in_subscribe_context");
        }
        if (this.pipe_caches) {
            throw new redis_errors_1.RedisError("in_pipeline_context");
        }
        if (!this.mult_backs) {
            this.mult_backs = [];
            try {
                this.send(CmdMulti).wait(castBool);
                this.mult_backs = [];
            }
            catch (e) {
                this.mult_backs = null;
                throw e;
            }
        }
        return this;
    }
    exec() {
        var fns = this.mult_backs;
        this.mult_backs = null;
        return this.send(CmdExec).wait(function (a) {
            a.forEach((v, k, o) => {
                o[k] = fns[k] ? fns[k](v) : v;
            });
            return a;
        });
    }
    pipeOpen() {
        if (this.mult_backs || this.sub_backs) {
            throw new redis_errors_1.RedisError("in_mult_ctx or in_subscribe_ctx");
        }
        if (!this.pipe_caches) {
            this.pipe_caches = [];
            this.pipe_casts = [];
        }
        return this;
    }
    pipeSubmit() {
        var caches = this.pipe_caches;
        var fns = this.pipe_casts;
        if (!caches || caches.length == 0) {
            this.pipe_caches = null;
            this.pipe_casts = null;
            return [];
        }
        if (!this.connected && this.opts.autoReconnect && !this.killed) {
            this.onOpen.wait(); //重连
        }
        this.pipe_caches = null;
        this.pipe_casts = null;
        var pipe_evt = new PipelineOptEvent(fns);
        fns.forEach(e => {
            this.backs.push(pipe_evt);
        });
        try {
            this.socket.send(Buffer.concat(caches));
        }
        catch (e) {
            this.on_err(e, true);
            throw e;
        }
        return pipe_evt.waitAll(true);
    }
    publish(channel, data) {
        return this.send(CmdPublish, channel, data).wait(castNumber);
    }
    exists(key) {
        return this.send(CmdExists, key).wait(castBool);
    }
    type(key) {
        return this.send(CmdType, key).wait(castStr);
    }
    keys(pattern) {
        return this.send(CmdKeys, pattern).wait(castStrs);
    }
    rename(key, newkey) {
        return this.send(CmdRename, key, newkey).wait(castBool);
    }
    renameNX(key, newkey) {
        return this.send(CmdRenameNX, key, newkey).wait(castBool);
    }
    del(...keys) {
        keys = util.isArray(keys[0]) ? keys[0] : keys;
        return this.send(CmdDel, ...keys).wait(castNumber);
    }
    unlink(...keys) {
        keys = util.isArray(keys[0]) ? keys[0] : keys;
        return this.send(CmdUnlink, ...keys).wait(castNumber);
    }
    expire(key, ttl = 0) {
        return this.send(CmdExpire, key, ttl).wait(castBool);
    }
    pexpire(key, ttl = 0) {
        return this.send(CmdPexpire, key, ttl).wait(castBool);
    }
    pttl(key) {
        return this.send(CmdPttl, key).wait(castNumber);
    }
    ttl(key) {
        return this.send(CmdTtl, key).wait(castNumber);
    }
    persist(key) {
        return this.send(CmdPersist, key).wait(castBool);
    }
    set(key, val, ttl = 0) {
        if (ttl < 1) {
            return this.send(CmdSet, key, val).wait(castBool);
        }
        return this.send(CmdSet, key, val, CmdOptEX, ttl).wait(castBool);
    }
    add(key, val, ttl = 0) {
        if (ttl < 1) {
            return this.send(CmdSet, key, val, CmdOptNX).wait(castBool);
        }
        return this.send(CmdSet, key, val, CmdOptEX, ttl, CmdOptNX).wait(castBool);
    }
    setNX(key, val, ttl = 0) {
        if (ttl < 1) {
            return this.send(CmdSet, key, val, CmdOptNX).wait(castBool);
        }
        return this.send(CmdSet, key, val, CmdOptEX, ttl, CmdOptNX).wait(castBool);
    }
    setXX(key, val, ttl = 0) {
        if (ttl < 1) {
            return this.send(CmdSet, key, val, CmdOptXX).wait(castBool);
        }
        return this.send(CmdSet, key, val, CmdOptEX, ttl, CmdOptXX).wait(castBool);
    }
    mset(...kvs) {
        kvs = kvs.length == 1 ? toArray(kvs, []) : kvs;
        return this.send(CmdMSet, ...kvs).wait(castBool);
    }
    msetNX(...kvs) {
        kvs = kvs.length == 1 ? toArray(kvs, []) : kvs;
        return this.send(CmdMSetNX, ...kvs).wait(castBool);
    }
    append(key, val) {
        return this.send(CmdAppend, key, val).wait(castBool);
    }
    setRange(key, offset, val) {
        return this.send(CmdSetRange, key, offset, val).wait(castNumber);
    }
    getRange(key, start, end, castFn = castStr) {
        return this.send(CmdGetRange, key, start, end).wait(castFn);
    }
    strlen(key) {
        return this.send(CmdStrlen, key).wait(castNumber);
    }
    bitcount(key) {
        return this.send(CmdBitcount, key).wait(castNumber);
    }
    get(key, castFn = castStr) {
        return this.send(CmdGet, key).wait(castFn);
    }
    mget(keys, castFn = castStrs) {
        return this.send(CmdMGet, ...keys).wait(castFn);
    }
    getSet(key, val, castFn = castStr) {
        return this.send(CmdGetSet, key, val).wait(castFn);
    }
    incr(key, castFn = castNumber) {
        return this.send(CmdIncr, key).wait(castFn);
    }
    decr(key, castFn = castNumber) {
        return this.send(CmdDecr, key).wait(castFn);
    }
    incrBy(key, step, castFn = castNumber) {
        return this.send(CmdIncrBy, key, step).wait(castFn);
    }
    decrBy(key, step, castFn = castNumber) {
        return this.send(CmdDecrBy, key, step).wait(castFn);
    }
    setBit(key, offset, val) {
        return this.send(CmdSetbit, key, offset, val).wait(castBool);
    }
    getBit(key, offset) {
        return this.send(CmdGetbit, key, offset).wait(castNumber);
    }
    scan_act(parse, cmd, key, cursor, matchPattern, matchCount) {
        var args = cmd == 'scan' ? [cmd, cursor] : [cmd, key, cursor];
        if (matchPattern && matchPattern.length > 0) {
            args.push('MATCH', matchPattern);
        }
        if (Number.isInteger(matchCount)) {
            args.push('COUNT', matchCount);
        }
        var a = this.send(parse, cmd, ...args).wait();
        a[0] = Number(a[0].toString());
        a[1] = parse(a[1]);
        if (cmd == 'hscan' || cmd == 'zscan') {
            var arr = a[1];
            var obj = {};
            for (var i = 0; i < arr.length; i += 2) {
                obj[arr[i].toString()] = arr[i + 1];
            }
            a[1] = obj;
        }
        a.cursor = a[0];
        a.list = a[1];
        return a;
    }
    scan(cursor, matchPattern, matchCount, castFn = castStrs) {
        return this.scan_act(castFn, 'scan', null, cursor, matchPattern, matchCount);
    }
    sscan(key, cursor, matchPattern, matchCount, castFn = castStrs) {
        return this.scan_act(castFn, 'sscan', key, cursor, matchPattern, matchCount);
    }
    hscan(key, cursor, matchPattern, matchCount, castFn = castStrs) {
        return this.scan_act(castFn, 'hscan', key, cursor, matchPattern, matchCount);
    }
    zscan(key, cursor, matchPattern, matchCount, castFn = castStrs) {
        return this.scan_act(castFn, 'zscan', key, cursor, matchPattern, matchCount);
    }
    geoadd(key, ...LngLatMembers) {
        LngLatMembers.unshift('geoadd', key);
        return this.send(...LngLatMembers).send(castNumber);
    }
    geodist(key, m1, m2, unit) {
        var args = ['geodist', key, m1, m2];
        if (unit) {
            args.push(unit);
        }
        return this.send(...args).wait(castNumber);
    }
    geohash(key, ...members) {
        members.unshift('geohash', key);
        return this.send(...members).wait(castStrs);
    }
    geopos(key, ...members) {
        members.unshift('geopos', key);
        var a = this.send(...members).wait();
        a.forEach((v, k, o) => {
            if (v) {
                v[0] = Number(v[0]);
                v[1] = Number(v[1]);
                o[k] = v;
            }
        });
        return a;
    }
    georadius(key, longitude, latitude, radius, unit, withOpts) {
        var args = ['georadius', key, longitude, latitude, radius, unit];
        if (withOpts) {
            withOpts.forEach(v => {
                args.push(v);
            });
        }
        var a = this.send(...args).wait();
        a.forEach((v, k, o) => {
            v[0] = v[0].toString();
            if (Array.isArray(v[1])) {
                v[1].forEach((vv, kk, oo) => {
                    oo[kk] = Number(vv);
                });
            }
            o[k] = v;
        });
        return a;
    }
    georadiusbymember(key, member, radius, unit) {
        var args = ['georadiusbymember', key, member, radius, unit];
        return this.send(...args).wait(castStrs);
    }
    lPush(key, val) {
        return this.send(CmdLpush, key, val).wait(castNumber);
    }
    rPush(key, val) {
        return this.send(CmdRpush, key, val).wait(castNumber);
    }
    lPushx(key, val) {
        return this.send(CmdLpushx, key, val).wait(castNumber);
    }
    rPushx(key, val) {
        return this.send(CmdRpushx, key, val).wait(castNumber);
    }
    lLen(key) {
        return this.send(CmdLlen, key).wait(castNumber);
    }
    lPop(key, castFn = castStr) {
        return this.send(CmdLpop, key).wait(castFn);
    }
    rPop(key, castFn = castStr) {
        return this.send(CmdRpop, key).wait(castFn);
    }
    lIndex(key, offset, castFn = castStr) {
        return this.send(CmdLindex, key, offset).wait(castFn);
    }
    lInsert(key, pivot, val, toBefore = true) {
        return this.send(CmdLinsert, key, toBefore ? 'BEFORE' : 'AFTER', pivot, val).wait(castNumber);
    }
    lSet(key, index, val) {
        return this.send(CmdLset, key, index, val).wait(castBool);
    }
    lRem(key, count, val) {
        return this.send(CmdLrem, key, count, val).wait(castNumber);
    }
    lTrim(key, start, stop) {
        return this.send(CmdLtrim, key, start, stop).wait(castNumber);
    }
    lRange(key, start, stop, castFn = castStrs) {
        return this.send(CmdLrange, key, start, stop).wait(castFn);
    }
    bLpop(key, timeout, castFn = castStr) {
        var args = Array.isArray(key) ? [CmdBlpop, ...key, timeout] : [CmdBlpop, key, timeout];
        return this.send(...args).wait(castFn);
    }
    bRpop(key, timeout, castFn = castStr) {
        var args = Array.isArray(key) ? [CmdBrpop, ...key, timeout] : [CmdBrpop, key, timeout];
        return this.send(...args).wait(castFn);
    }
    bRpopLpush(srcKey, destKey, timeout, castFn = castStr) {
        var args = [CmdBrpopLpush, srcKey, destKey, timeout];
        return this.send(...args).wait(castFn);
    }
    rPopLpush(srcKey, destKey, castFn = castStr) {
        return this.send(CmdRpopLpush, srcKey, destKey).wait(castFn);
    }
    sAdd(key, ...members) {
        if (members.length == 1 && util.isArray(members[0])) {
            members = members[0];
        }
        members.unshift(CmdSadd, key, members);
        return this.send(...members).wait(castNumber);
    }
    sRem(key, ...members) {
        if (members.length == 1 && util.isArray(members[0])) {
            members = members[0];
        }
        members.unshift(CmdSrem, key, members);
        return this.send(...members).wait(castNumber);
    }
    sCard(key) {
        return this.send(CmdScard, key).wait(castNumber);
    }
    sPop(key, num = 1, castFn = castStrs) {
        return this.send(CmdSpop, key, num).wait(castFn);
    }
    sRandmember(key, num = 1, castFn = castStrs) {
        return this.send(CmdSrandmember, key, num).wait(castFn);
    }
    sIsmember(key, member) {
        return this.send(CmdSismember, key, member).wait(castBool);
    }
    sDiff(keys, castFn = castStrs) {
        return this.send(CmdSdiff, ...keys).wait(castFn);
    }
    sDiffStore(destKey, keys) {
        return this.send(CmdSdiffStore, destKey, ...keys).wait(castNumber);
    }
    sInter(keys, castFn = castStrs) {
        return this.send(CmdSinter, ...keys).wait(castFn);
    }
    sInterStore(destKey, keys) {
        return this.send(CmdSinterStore, destKey, ...keys).wait(castNumber);
    }
    sUnion(keys, castFn = castStrs) {
        return this.send(CmdSunion, ...keys).wait(castFn);
    }
    sUnionStore(destKey, keys) {
        return this.send(CmdSunionStore, destKey, ...keys).wait(castNumber);
    }
    sMembers(key, castFn = castStrs) {
        return this.send(CmdSmembers, key).wait(castFn);
    }
    sMove(sourceKey, destKey, member) {
        return this.send(CmdSmove, sourceKey, destKey, member).wait(castNumber);
    }
    zAdd(key, sms, opts) {
        var smsArr = Array.isArray(sms) ? sms : toZsetArray(sms, []);
        if (!opts) {
            opts = [];
        }
        return this.send(CmdZadd, key, opts.join(''), ...smsArr).wait(castNumber);
    }
    zCard(key) {
        return this.send(CmdZcard, key).wait(castNumber);
    }
    zCount(key, min, max) {
        return this.send(CmdZcount, key, min, max).wait(castNumber);
    }
    zLexCount(key, min, max) {
        return this.send(CmdZlexcount, key, min, max).wait(castNumber);
    }
    zIncrBy(key, member, increment, castFn = castNumber) {
        return this.send(CmdZincrBy, key, increment, member).wait(castFn);
    }
    zScore(key, member, castFn = castNumber) {
        return this.send(CmdZscore, key, member).wait(castFn);
    }
    zRank(key, member) {
        return this.send(CmdZrank, key, member).wait(castNumber);
    }
    zRem(key, ...members) {
        return this.send(CmdZrem, key, ...members).wait(castNumber);
    }
    zRemByLex(key, min, max) {
        return this.send(CmdZremRangeByLex, key, min, max).wait(castNumber);
    }
    zRemByScore(key, min, max) {
        return this.send(CmdZremRangeByScore, key, min, max).wait(castNumber);
    }
    zRemByRank(key, start, stop) {
        return this.send(CmdZremRangeByRank, key, start, stop).wait(castNumber);
    }
    z_act(castFn, scorePv, args) {
        if (scorePv == 0) {
            return this.send(...args).wait(castFn);
        }
        var r = this.send(...args).wait();
        var list = [];
        if (scorePv == 1) {
            for (var i = 0; i < r.length; i += 2) {
                var member = r[i].toString();
                var score = Number(r[i + 1].toString());
                list.push({ member: member, score: score });
            }
        }
        else {
            for (var i = 0; i < r.length; i += 2) {
                var member = r[i + 1].toString();
                var score = Number(r[i].toString());
                list.push({ member: member, score: score });
            }
        }
        return list;
    }
    zPopMin(key, num = 1, castFn = castStrs) {
        return this.z_act(castFn, 1, [CmdZpopmin, key, num]);
    }
    zPopMax(key, num = 1, castFn = castStrs) {
        return this.z_act(castFn, 1, [CmdZpopmax, key, num]);
    }
    zRange(key, start, stop, castFn = castStrs) {
        return this.z_act(castFn, 0, [CmdZrange, key, start, stop]);
    }
    zRangeWithscore(key, start, stop, castFn = castStrs) {
        return this.z_act(castFn, -1, [CmdZrange, key, start, stop]);
    }
    zRevRange(key, start, stop, withScore, castFn = castStrs) {
        return this.z_act(castFn, 0, [CmdZrevRange, key, start, stop]);
    }
    zRevRangeWithscore(key, start, stop, castFn = castStrs) {
        return this.z_act(castFn, -1, [CmdZrevRange, key, start, stop]);
    }
    zRangeByScore(key, min, max, opts = { withScore: false }, castFn = castStrs) {
        var args = [CmdZrangeByScore, key, min, max];
        if (opts.limit) {
            args.push('LIMIT', opts.limit.offset, opts.limit.count);
        }
        return this.z_act(castFn, opts.withScore ? -1 : 0, args);
    }
    zRevRangeByScore(key, min, max, opts = { withScore: false }, castFn = castStrs) {
        var args = [CmdZrevrangeByScore, key, min, max];
        if (opts.limit) {
            args.push('LIMIT', opts.limit.offset, opts.limit.count);
        }
        return this.z_act(castFn, opts.withScore ? -1 : 0, args);
    }
    bzPopMin(key, timeout = 0, castFn = castStr) {
        var args = Array.isArray(key) ? [CmdBzPopMin, ...key, timeout] : [CmdBzPopMin, key, timeout];
        var r = this.send(...args).wait();
        r[0] = r[0].toString();
        r[1] = Number(r[1].toString());
        r[2] = castFn(r[2]);
        return r;
    }
    bzPopMax(key, timeout = 0, castFn = castStr) {
        var args = Array.isArray(key) ? [CmdBzPopMax, ...key, timeout] : [CmdBzPopMax, key, timeout];
        var r = this.send(...args).wait();
        r[0] = r[0].toString();
        r[1] = Number(r[1].toString());
        r[2] = castFn(r[2]);
        return r;
    }
    real_sub(cmd, key, fn, isSubscribe) {
        this.pre_sub();
        var r = this.send(cmd, key).wait();
        var fns = isSubscribe ? this.subFn : this.psubFn;
        if (fns[key] == null) {
            fns[key] = [];
        }
        fns[key].push(fn);
        return r;
    }
    subscribe(key, fn) {
        if (key == null || key.length < 1 || !util.isFunction(fn))
            return;
        if (util.isArray(key)) {
            var arr = key;
            arr.forEach(e => {
                this.real_sub(CmdSubscribe, e, fn, true);
            });
        }
        else {
            this.real_sub(CmdSubscribe, key.toString(), fn, true);
        }
    }
    psubscribe(key, fn) {
        if (key == null || key.length < 1 || !util.isFunction(fn))
            return;
        if (util.isArray(key)) {
            var arr = key;
            arr.forEach(e => {
                this.real_sub(CmdPSubscribe, e, fn, false);
            });
        }
        else {
            this.real_sub(CmdPSubscribe, key.toString(), fn, false);
        }
    }
    real_unsub(cmd, key, fn, fns) {
        if (!fns) {
            return;
        }
        var r = this.send(cmd, key).wait();
        var idx = fns[key].indexOf(fn);
        if (idx > -1) {
            fns[key].splice(idx, 1);
        }
        if (r < 1) {
            delete fns[key];
        }
        this.after_unsub();
        return r;
    }
    unsubscribe(key, fn) {
        return this.real_unsub(CmdUnSubscribe, key, fn, this.subFn);
    }
    punsubscribe(key, fn) {
        return this.real_unsub(CmdPUnSubscribe, key, fn, this.psubFn);
    }
    unsubscribeAll(key) {
        var fns = this.subFn;
        var num = fns && fns[key] ? fns[key].length : 1;
        for (var i = 0; i < (num + 1); i++) {
            this.real_unsub(CmdUnSubscribe, key, null, fns);
        }
    }
    punsubscribeAll(key) {
        var fns = this.psubFn;
        var num = fns && fns[key] ? fns[key].length : 1;
        for (var i = 0; i < (num + 1); i++) {
            this.real_unsub(CmdPUnSubscribe, key, null, fns);
        }
    }
    pre_sub() {
        if (!this.connected) {
            throw new redis_errors_1.RedisError("io_error");
        }
        if (!this.sub_backs) {
            if (this.mult_backs) {
                throw new redis_errors_1.RedisError("in_mult_exec");
            }
            if (this.pipe_caches) {
                throw new redis_errors_1.RedisError("in_pipeline_ctx");
            }
            if (this.backs.length > 0) {
                this.backs[this.backs.length - 1].wait();
            }
            this.sub_backs = [];
            this.subFn = {};
            this.psubFn = {};
        }
    }
    after_unsub() {
        if (Object.keys(this.subFn).length < 1 && Object.keys(this.psubFn).length < 1) {
            if (this.sub_backs.length > 0) {
                this.sub_backs[this.sub_backs.length - 1].wait();
                this.after_unsub();
                return;
            }
            this.sub_backs = null;
            this.subFn = null;
            this.psubFn = null;
        }
    }
    pre_sub_onConnect() {
        var subFn = this.subFn;
        var psubFn = this.psubFn;
        var had = (subFn && Object.keys(subFn).length > 0) || (psubFn && Object.keys(psubFn).length > 0);
        this.sub_backs = null;
        this.subFn = null;
        this.psubFn = null;
        if (had) {
            try {
                if (subFn) {
                    for (var k in subFn) {
                        var arr = subFn[k];
                        for (var i = 0; i < arr.length; i++) {
                            this.subscribe(k, arr[i]);
                        }
                    }
                }
                if (psubFn) {
                    for (var k in psubFn) {
                        var arr = psubFn[k];
                        for (var i = 0; i < arr.length; i++) {
                            this.psubscribe(k, arr[i]);
                        }
                    }
                }
            }
            catch (e) {
                this.subFn = subFn;
                this.psubFn = psubFn;
            }
        }
    }
    on_subReply(reply) {
        if (CmdMessage.compare(reply[0]) == 0) {
            var channel = reply[1].toString();
            this.subFn[channel].forEach(f => {
                f(reply[2], channel);
            });
        }
        else if (CmdPMessage.compare(reply[0]) == 0) {
            var channel = reply[1].toString();
            this.psubFn[channel].forEach(f => {
                f(reply[2], channel);
            });
        }
        else {
            if (CmdUnSubscribe.compare(reply[0]) == 0) {
                this.sub_backs.shift().then(parseInt(reply[2].toString()));
            }
            else if (CmdPUnSubscribe.compare(reply[0])) {
                this.sub_backs.shift().then(parseInt(reply[2].toString()));
            }
            else if (CmdPong.compare(reply[0]) == 0) {
                this.sub_backs.shift().then('pong');
            }
            else {
                this.sub_backs.shift().then(reply);
            }
        }
    }
}
module.exports = Redis;
class OptEvent {
    constructor() {
        this.evt = new coroutine.Event(false);
    }
    wait(convert) {
        this.evt.wait();
        if (this.err) {
            throw this.err;
        }
        return convert ? convert(this.data) : this.data;
    }
    then(data) {
        this.data = data;
        this.evt.set();
    }
    fail(e) {
        this.err = e;
        this.evt.set();
    }
}
class PipelineOptEvent extends OptEvent {
    constructor(fns) {
        super();
        this.fns = fns;
        this.rets = [];
        this.errs = [];
    }
    waitAll(throwErr) {
        this.evt.wait();
        if (this.errs.length > 0) {
            if (throwErr) {
                throw this.errs[0];
            }
        }
        return this.rets;
    }
    then(data) {
        var fn = this.fns[this.rets.length];
        this.rets.push(fn ? fn(data) : data);
        this.check();
    }
    fail(e) {
        this.rets.push(undefined);
        this.errs.push(e);
        this.check();
    }
    check() {
        if (this.rets.length >= this.fns.length) {
            this.evt.set();
        }
    }
}
function toArray(hash, array) {
    for (const key of Object.keys(hash)) {
        array.push(key, hash[key]);
    }
    return array;
}
function toZsetArray(hash, array) {
    for (const key of Object.keys(hash)) {
        array.push(hash[key], key);
    }
    return array;
}
function castBool(buf) {
    if (util.isBoolean(buf)) {
        return buf;
    }
    if (util.isNumber(buf)) {
        return buf != 0;
    }
    return buf != null;
}
function castStr(buf) {
    return buf ? buf.toString() : null;
}
function castStrs(bufs) {
    bufs.forEach((v, k, a) => {
        a[k] = v ? v.toString() : v;
    });
    return bufs;
}
function castNumber(buf) {
    if (buf) {
        if (!util.isNumber(buf)) {
            buf = Number(buf.toString());
        }
    }
    return buf;
}
function castBigInt(buf) {
    if (buf) {
        buf = global["BigInt"](buf.toString());
    }
    return buf;
}
function castNumbers(bufs) {
    bufs.forEach((v, k, a) => {
        if (v != null) {
            var n = Number(v.toString());
            if (isNaN(n)) {
                v = v.toString();
            }
            a[k] = v;
        }
    });
}
function castAuto(a) {
    if (a == null)
        return a;
    if (util.isNumber(a))
        return a;
    if (Buffer.isBuffer(a)) {
        a = a.toString();
        var n = Number(a);
        if (!isNaN(n)) {
            return n;
        }
        return a;
    }
    if (util.isArray(a)) {
        a.forEach((iv, ik, ia) => {
            ia[ik] = castAuto(iv);
        });
    }
    return a;
}
Redis["castAuto"] = castAuto;
Redis["castStr"] = castStr;
Redis["castStrs"] = castStrs;
Redis["castNumber"] = castNumber;
Redis["castNumbers"] = castNumbers;
Redis["castBigInt"] = castBigInt;
Redis["castBool"] = castBool;
const CODEC = 'utf8';
const CHAR_Star = Buffer.from('*', CODEC);
const CHAR_Dollar = Buffer.from('$', CODEC);
const BUF_EOL = Buffer.from('\r\n', CODEC);
const BUF_OK = Buffer.from('OK', CODEC);
function encodeWord(code) {
    const buf = Buffer.isBuffer(code) ? code : Buffer.from(String(code), CODEC);
    const buf_len = Buffer.from(String(buf.length), CODEC);
    return Buffer.concat([CHAR_Dollar, buf_len, BUF_EOL, buf, BUF_EOL]);
}
function encodeCommand(command) {
    const resps = command.map(encodeWord);
    const size = Buffer.from(String(resps.length), CODEC);
    return Buffer.concat([
        CHAR_Star, size, BUF_EOL, ...resps, BUF_EOL
    ]);
}
exports.encodeCommand = encodeCommand;
function encodeMultCommand(commands) {
    const arrs = commands.map(encodeOneResp);
    return Buffer.concat([...arrs, BUF_EOL]);
}
exports.encodeMultCommand = encodeMultCommand;
function encodeOneResp(command) {
    const resps = command.map(encodeWord);
    const size = Buffer.from(String(resps.length), CODEC);
    return Buffer.concat([
        CHAR_Star, size, BUF_EOL, ...resps
    ]);
}
const CmdSubscribe = Buffer.from('subscribe');
const CmdPSubscribe = Buffer.from('psubscribe');
const CmdUnSubscribe = Buffer.from('unsubscribe');
const CmdPUnSubscribe = Buffer.from('punsubscribe');
const CmdMessage = Buffer.from('message');
const CmdPMessage = Buffer.from('pmessage');
const CmdPong = Buffer.from('pong');
const CmdQuit = Buffer.from('quit');
const CmdPing = Buffer.from('ping');
const CmdAuth = Buffer.from('auth');
const CmdSelect = Buffer.from('select');
const CmdPublish = Buffer.from('publish');
const CmdExists = Buffer.from('exists');
const CmdKeys = Buffer.from('keys');
const CmdType = Buffer.from('type');
const CmdDel = Buffer.from('del');
const CmdUnlink = Buffer.from('unlink');
const CmdRename = Buffer.from('rename');
const CmdRenameNX = Buffer.from('renamenx');
const CmdPexpire = Buffer.from('pexpire');
const CmdExpire = Buffer.from('expire');
const CmdPttl = Buffer.from('pttl');
const CmdTtl = Buffer.from('ttl');
const CmdPersist = Buffer.from('persist');
const CmdGet = Buffer.from('get');
const CmdSet = Buffer.from('set');
const CmdOptEX = Buffer.from('EX');
const CmdOptPX = Buffer.from('PX');
const CmdOptNX = Buffer.from('NX');
const CmdOptXX = Buffer.from('XX');
const CmdMSetNX = Buffer.from('msetnx');
const CmdMSet = Buffer.from('mset');
const CmdAppend = Buffer.from('append');
const CmdBitcount = Buffer.from('bitcount');
const CmdStrlen = Buffer.from('strlen');
const CmdSetRange = Buffer.from('setrange');
const CmdGetRange = Buffer.from('getrange');
const CmdMGet = Buffer.from('mget');
const CmdGetSet = Buffer.from('getset');
const CmdDecr = Buffer.from('decr');
const CmdIncr = Buffer.from('incr');
const CmdDecrBy = Buffer.from('decrby');
const CmdIncrBy = Buffer.from('incrby');
const CmdSetbit = Buffer.from('setbit');
const CmdGetbit = Buffer.from('getbit');
const CmdLpush = Buffer.from('lpush');
const CmdLpushx = Buffer.from('lpushx');
const CmdRpush = Buffer.from('rpush');
const CmdRpushx = Buffer.from('rpushx');
const CmdLpop = Buffer.from('lpop');
const CmdRpop = Buffer.from('rpop');
const CmdLlen = Buffer.from('llen');
const CmdLindex = Buffer.from('lindex');
const CmdLinsert = Buffer.from('linsert');
const CmdLrange = Buffer.from('lrange');
const CmdLtrim = Buffer.from('ltrim');
const CmdLrem = Buffer.from('lrem');
const CmdLset = Buffer.from('lset');
const CmdBlpop = Buffer.from('blpop');
const CmdBrpop = Buffer.from('brpop');
const CmdBrpopLpush = Buffer.from('bropolpush');
const CmdRpopLpush = Buffer.from('rpoplpush');
const CmdSadd = Buffer.from('sadd');
const CmdSrem = Buffer.from('srem');
const CmdScard = Buffer.from('scard');
const CmdSpop = Buffer.from('spop');
const CmdSrandmember = Buffer.from('srandmember');
const CmdSdiff = Buffer.from('sdiff');
const CmdSdiffStore = Buffer.from('sdiffstore');
const CmdSinter = Buffer.from('sinter');
const CmdSinterStore = Buffer.from('sinterstore');
const CmdSunion = Buffer.from('sunion');
const CmdSunionStore = Buffer.from('sunionstore');
const CmdSismember = Buffer.from('sismember');
const CmdSmembers = Buffer.from('smembers');
const CmdSmove = Buffer.from('smove');
const CmdZadd = Buffer.from('zadd');
const CmdZcard = Buffer.from('zcard');
const CmdZcount = Buffer.from('zcount');
const CmdZlexcount = Buffer.from('zlexcount');
const CmdZincrBy = Buffer.from('zincrby');
const CmdZscore = Buffer.from('zscore');
const CmdZrank = Buffer.from('zrank');
const CmdZrem = Buffer.from('zrem');
const CmdZremRangeByLex = Buffer.from('zremrangebylex');
const CmdZremRangeByScore = Buffer.from('zrangebyscore');
const CmdZremRangeByRank = Buffer.from('zremrangebyrank');
const CmdZpopmax = Buffer.from('zpopmax');
const CmdZpopmin = Buffer.from('zpopmin');
const CmdZrange = Buffer.from('zrange');
const CmdZrevRange = Buffer.from('zrevrange');
const CmdZrangeByScore = Buffer.from('zrangebyscore');
const CmdZrevrangeByScore = Buffer.from('zrevrangebyscore');
const CmdZrangeByLex = Buffer.from('zrangebylex');
const CmdZrevrangeByLex = Buffer.from('zremrangebylex');
const CmdBzPopMin = Buffer.from('bzpopmin');
const CmdBzPopMax = Buffer.from('bzpopmax');
const CmdWatch = Buffer.from('watch');
const CmdUnWatch = Buffer.from('unwatch');
const CmdMulti = Buffer.from('multi');
const CmdExec = Buffer.from('exec');
