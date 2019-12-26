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
        this._prefix = { str: "", buf: null };
        this._step = 0;
        this._temp_cmds = [];
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
            if (query.prefix) {
                this.prefix = String(query.prefix).trim();
            }
        }
        this._opts = { db: initDb, timeout: timeout, autoReconnect: autoReconnect, auth: auth, host: host, port: port, };
        this._onOpen = new coroutine.Event(false);
        this._waitWrite = {
            cmds: [],
            event: new coroutine.Event(false)
        };
        this._do_conn();
    }
    get prefix() {
        return this._prefix.str;
    }
    set prefix(s) {
        if (s == null || s.length == 0) {
            this._prefix = { str: "", buf: null };
        }
        else {
            this._prefix = { str: s, buf: Buffer.from(s) };
        }
    }
    _do_conn() {
        let opts = this._opts;
        var sock = new net.Socket();
        sock.timeout = opts.timeout;
        sock.connect(opts.host, opts.port);
        var buf = new io.BufferedStream(sock);
        buf.EOL = "\r\n";
        opts.auth && this._pre_command(sock, buf, 'auth', opts.auth);
        opts.db > 0 && this._pre_command(sock, buf, 'select', opts.db);
        this._socket = sock;
        // this.stream=buf;
        this._backs = [];
        this._connected = true;
        this._pre_Fibers();
        this.pre_sub_onConnect();
        this._onOpen.set();
    }
    _pre_Fibers() {
        let T = this;
        T._socket.timeout = -1;
        T._sender = coroutine.start(function () {
            let self = T, sock = self._socket, buf, tcs = self._waitWrite.cmds, evt = self._waitWrite.event;
            while (self._socket === sock && self._connected) {
                if (tcs.length > 0) {
                    buf = tcs.length == 1 ? tcs[0] : Buffer.concat(tcs);
                    tcs.length = 0;
                    try {
                        sock.send(buf);
                    }
                    catch (e) {
                        self._on_err(e, true);
                        break;
                    }
                }
                else {
                    evt.clear();
                    evt.wait();
                }
            }
        });
        T._reader = coroutine.start(function () {
            var buf = null;
            let self = T, sock = self._socket, parser = self._parser, step = self._step, bufSize = self.bufSize;
            while (self._socket === sock && self._connected) {
                try {
                    buf = sock.recv(bufSize);
                    if (buf == null) {
                        self._on_lost();
                        break;
                    }
                    if (self._step != step || self._socket != sock) {
                        continue;
                    }
                    parser.execute(buf);
                }
                catch (e) {
                    if (!self._killed) {
                        console.error("Redis|on_read", e);
                        self._on_err(e);
                    }
                    break;
                }
            }
        });
        var self = T, step = self._step;
        T._parser = new RedisParser({
            returnBuffers: true,
            optionStringNumbers: true,
            returnReply: reply => {
                // console.log("--->>>",reply.toString())
                try {
                    if (self._sub_backs) {
                        self._on_subReply(reply);
                    }
                    else {
                        self._backs.shift().then(reply);
                    }
                }
                catch (exx) {
                    // console.error("--->>>", self._step==step,(reply||"null").toString(),exx)
                    console.error("Redis|on_reply", exx);
                }
            },
            returnError: error => {
                try {
                    if (self._sub_backs) {
                        self._sub_backs.shift().fail(error);
                    }
                    else {
                        self._backs.shift().fail(error);
                    }
                }
                catch (exx) {
                    // console.error("--->>>", self._step==step,(reply||"null").toString(),exx)
                    console.error("Redis|on_reply", exx);
                }
            }
        });
    }
    _pre_command(sock, buf, ...args) {
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
    _on_lost() {
        this._on_err(new Error("io_error"), true);
    }
    _on_err(e, deadErr) {
        if (this._socket == null) {
            return;
        }
        this._step++;
        if (this._step > 0x0FFFFFFFFFFFFF) {
            this._step = 0;
        }
        try {
            this._socket.close();
        }
        catch (e) {
        }
        this._connected = false;
        this._onOpen.clear();
        this._waitWrite.cmds.length = 0;
        this._waitWrite.event.set();
        var backs = this._backs;
        this._backs = [];
        backs.forEach(operation => {
            operation.fail(e);
        });
        backs = this._sub_backs;
        this._sub_backs = null;
        if (backs) {
            backs.forEach(operation => {
                operation.fail(e);
            });
        }
        this._mult_backs = null;
        if (this._opts.autoReconnect && !this._killed) {
            var i = 0;
            while (!this._connected && !this._killed) {
                try {
                    this._do_conn();
                    break;
                }
                catch (e) {
                    console.error("Redis|%s", this._opts.host + ":" + this._opts.port, e);
                    try {
                        this._socket.close();
                    }
                    catch (e) {
                    }
                }
                i++;
                coroutine.sleep(Math.min(i * 5, 500));
            }
        }
    }
    close() {
        this._killed = true;
        this._connected = false;
        var sock = this._socket;
        this._socket = null;
        try {
            sock.close();
        }
        catch (e) {
        }
        var backs = this._backs;
        this._backs = [];
        var e = new Error("io_close");
        backs.forEach(operation => {
            operation.fail(e);
        });
    }
    send(...args) {
        var pipe = PipeWrap.get();
        if (pipe) {
            pipe.commands.push(encodeCommand(args));
        }
        else {
            if (this._killed) {
                throw new redis_errors_1.RedisError("io_had_closed");
            }
            if (!this._connected && this._opts.autoReconnect) {
                if (this.waitReconnect) {
                    this._onOpen.wait(); //等待重连
                }
            }
            if (!this._socket || !this._connected) {
                throw new redis_errors_1.RedisError("io_error");
            }
            this._temp_cmds.push(encodeCommand(args));
        }
        return this;
    }
    wait(convert) {
        var pipe = PipeWrap.get();
        if (pipe) {
            pipe.casts.push(convert);
            return this;
        }
        var backs = this._backs;
        if (this._sub_backs) {
            backs = this._sub_backs;
        }
        else if (this._mult_backs) {
            this._mult_backs.push(convert);
            convert = castStr;
        }
        var evt = new OptEvent();
        backs.push(evt);
        this._waitWrite.cmds.push(...this._temp_cmds);
        this._temp_cmds.length = 0;
        this._waitWrite.event.set();
        return evt.wait(convert);
    }
    rawCommand(cmd, ...args) {
        // console.log("...>",cmd,...args);
        return this.send(...arguments).wait();
    }
    ping() {
        return this.send(CmdPing).wait(castStr);
    }
    quit() {
        var t = this.send(CmdQuit);
        t._killed = true;
        try {
            return t.wait(castBool);
        }
        finally {
            t.close();
        }
    }
    echo(s) {
        return this.send(CmdEcho, s).wait(castStr);
    }
    swapdb(a, b) {
        return this.send(CmdSwapdb, a, b).wait(castBool);
    }
    select(db) {
        return this.send(CmdSelect, db).wait(castBool);
    }
    info(option) {
        var args = option && option.length > 0 ? [CmdInfo, option] : [CmdInfo];
        return this.send(...args).wait(castStr);
    }
    client(subCommand) {
        return this.send(CmdClient, subCommand).wait(castStr);
    }
    time() {
        return this.send(CmdTime).wait(castNumbers);
    }
    slowlog(subCommand, ...subArgs) {
        return this.send(CmdSlowlog, ...arguments).wait(deepCastStrs);
    }
    slowlogLen() {
        return this.slowlog("len");
    }
    slowlogGet(n) {
        return this.slowlog("get", n);
    }
    config(subCommand, ...subArgs) {
        return this.send(CmdConfig, ...arguments).wait(deepCastStrs);
    }
    watch(...keys) {
        keys = util.isArray(keys[0]) ? keys[0] : keys;
        keys = this._fix_prefix_any(keys);
        return this.send(CmdWatch, ...keys).wait(castBool);
    }
    unwatch() {
        return this.send(CmdUnWatch).wait(castBool);
    }
    multi() {
        if (this._sub_backs) {
            throw new redis_errors_1.RedisError("in_subscribe_context");
        }
        if (!this._mult_backs) {
            this._mult_backs = [];
            try {
                this.send(CmdMulti).wait(castBool);
                this._mult_backs = [];
            }
            catch (e) {
                this._mult_backs = null;
                throw e;
            }
        }
        return this;
    }
    exec() {
        var fns = this._mult_backs;
        this._mult_backs = null;
        return this.send(CmdExec).wait(function (a) {
            a.forEach((v, k, o) => {
                o[k] = fns[k] ? fns[k](v) : v;
            });
            return a;
        });
    }
    pipeline(fn) {
        this.pipeOpen();
        fn(this);
        return this.pipeSubmit();
    }
    pipeOpen() {
        if (this._mult_backs || this._sub_backs) {
            throw new redis_errors_1.RedisError("in_mult_ctx or in_subscribe_ctx");
        }
        if (!PipeWrap.has()) {
            PipeWrap.start();
        }
        return this;
    }
    pipeSubmit() {
        var pipe = PipeWrap.finish();
        if (this._mult_backs || this._sub_backs) {
            throw new redis_errors_1.RedisError("in_mult_ctx or in_subscribe_ctx");
        }
        if (pipe.commands.length == 0) {
            return [];
        }
        if (!this._connected && this._opts.autoReconnect && !this._killed) {
            this._onOpen.wait(); //重连
        }
        var events = new PipelineOptEvent(pipe.casts);
        pipe.casts.forEach(e => {
            this._backs.push(events);
        });
        try {
            this._socket.send(Buffer.concat(pipe.commands));
        }
        catch (e) {
            this._on_err(e, true);
            throw e;
        }
        return events.waitAll(true);
    }
    keys(pattern) {
        pattern = this._fix_prefix_any(pattern);
        return this.send(CmdKeys, pattern).wait(castStrs);
    }
    exists(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdExists, key).wait(castBool);
    }
    type(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdType, key).wait(castStr);
    }
    rename(key, newkey) {
        key = this._fix_prefix_any(key);
        newkey = this._fix_prefix_any(newkey);
        return this.send(CmdRename, key, newkey).wait(castBool);
    }
    renameNX(key, newkey) {
        key = this._fix_prefix_any(key);
        newkey = this._fix_prefix_any(newkey);
        return this.send(CmdRenameNX, key, newkey).wait(castBool);
    }
    dump(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdDump, key).wait(castStr);
    }
    touch(...keys) {
        keys = util.isArray(keys[0]) ? keys[0] : keys;
        keys = this._fix_prefix_any(keys);
        return this.send(CmdTouch, ...keys).wait(castNumber);
    }
    move(key, toDb) {
        key = this._fix_prefix_any(key);
        return this.send(CmdMove, key, toDb).wait(castNumber);
    }
    randomKey() {
        return this.send(CmdRandomkey).wait(castStr);
    }
    del(...keys) {
        keys = util.isArray(keys[0]) ? keys[0] : keys;
        keys = this._fix_prefix_any(keys);
        return this.send(CmdDel, ...keys).wait(castNumber);
    }
    unlink(...keys) {
        keys = util.isArray(keys[0]) ? keys[0] : keys;
        keys = this._fix_prefix_any(keys);
        return this.send(CmdUnlink, ...keys).wait(castNumber);
    }
    expire(key, ttl = 0) {
        key = this._fix_prefix_any(key);
        return this.send(CmdExpire, key, ttl).wait(castBool);
    }
    pexpire(key, ttl = 0) {
        key = this._fix_prefix_any(key);
        return this.send(CmdPexpire, key, ttl).wait(castBool);
    }
    pttl(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdPttl, key).wait(castNumber);
    }
    ttl(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdTtl, key).wait(castNumber);
    }
    persist(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdPersist, key).wait(castBool);
    }
    set(key, val, ttl = 0) {
        key = this._fix_prefix_any(key);
        if (ttl < 1) {
            return this.send(CmdSet, key, val).wait(castBool);
        }
        return this.send(CmdSet, key, val, CmdOptEX, ttl).wait(castBool);
    }
    add(key, val, ttl = 0) {
        key = this._fix_prefix_any(key);
        if (ttl < 1) {
            return this.send(CmdSet, key, val, CmdOptNX).wait(castBool);
        }
        return this.send(CmdSet, key, val, CmdOptEX, ttl, CmdOptNX).wait(castBool);
    }
    setNX(key, val, ttl = 0) {
        key = this._fix_prefix_any(key);
        if (ttl < 1) {
            return this.send(CmdSet, key, val, CmdOptNX).wait(castBool);
        }
        return this.send(CmdSet, key, val, CmdOptEX, ttl, CmdOptNX).wait(castBool);
    }
    setXX(key, val, ttl = 0) {
        key = this._fix_prefix_any(key);
        if (ttl < 1) {
            return this.send(CmdSet, key, val, CmdOptXX).wait(castBool);
        }
        return this.send(CmdSet, key, val, CmdOptEX, ttl, CmdOptXX).wait(castBool);
    }
    mset(...kvs) {
        kvs = kvs.length == 1 ? toArray(kvs[0], []) : kvs;
        for (var i = 0; i < kvs.length; i += 2) {
            kvs[i] = this._fix_prefix_any(kvs[i]);
        }
        return this.send(CmdMSet, ...kvs).wait(castBool);
    }
    msetNX(...kvs) {
        kvs = kvs.length == 1 ? toArray(kvs[0], []) : kvs;
        for (var i = 0; i < kvs.length; i += 2) {
            kvs[i] = this._fix_prefix_any(kvs[i]);
        }
        return this.send(CmdMSetNX, ...kvs).wait(castBool);
    }
    append(key, val) {
        key = this._fix_prefix_any(key);
        return this.send(CmdAppend, key, val).wait(castBool);
    }
    setRange(key, offset, val) {
        key = this._fix_prefix_any(key);
        return this.send(CmdSetRange, key, offset, val).wait(castNumber);
    }
    getRange(key, start, end, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this.send(CmdGetRange, key, start, end).wait(castFn);
    }
    substr(key, start, end, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this.send(CmdSubstr, key, start, end).wait(castFn);
    }
    strlen(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdStrlen, key).wait(castNumber);
    }
    get(key, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this.send(CmdGet, key).wait(castFn);
    }
    mget(keys, castFn = castStrs) {
        var keys = this._fix_prefix_any(keys);
        return this.send(CmdMGet, ...keys).wait(castFn);
    }
    mgetWrap(keys, castFn = castStrs) {
        var preKeys = this._fix_prefix_any(keys);
        var a = this.send(CmdMGet, ...preKeys).wait(castFn);
        var r = {};
        for (var i = 0; i < keys.length; i++) {
            r[keys[i].toString()] = a[i];
        }
        return r;
    }
    getSet(key, val, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this.send(CmdGetSet, key, val).wait(castFn);
    }
    incr(key, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this.send(CmdIncr, key).wait(castFn);
    }
    decr(key, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this.send(CmdDecr, key).wait(castFn);
    }
    incrBy(key, step, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this.send(CmdIncrBy, key, step).wait(castFn);
    }
    decrBy(key, step, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this.send(CmdDecrBy, key, step).wait(castFn);
    }
    bitCount(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdBitcount, key).wait(castNumber);
    }
    bitPos(key, start, end) {
        key = this._fix_prefix_any(key);
        if (arguments.length > 2) {
            return this.send(CmdBitpos, key, start, end).wait(castNumber);
        }
        return this.send(CmdBitpos, key, start).wait(castNumber);
    }
    bitOp(option, destkey, ...keys) {
        keys.unshift(destkey);
        keys = this._fix_prefix_any(keys);
        keys.unshift(option);
        return this.send(CmdBitop, ...keys).wait(castNumber);
    }
    setBit(key, offset, val) {
        key = this._fix_prefix_any(key);
        return this.send(CmdSetbit, key, offset, val).wait(castBool);
    }
    getBit(key, offset) {
        key = this._fix_prefix_any(key);
        return this.send(CmdGetbit, key, offset).wait(castNumber);
    }
    _scan_act(parse, cmd, key, cursor, matchPattern, matchCount) {
        var args = cmd == 'scan' ? [cmd, cursor] : [cmd, key, cursor];
        if (matchPattern && matchPattern.length > 0) {
            args.push('MATCH', matchPattern);
        }
        if (Number.isInteger(matchCount)) {
            args.push('COUNT', matchCount);
        }
        var a = this.send(...args).wait();
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
        matchPattern = this._fix_prefix_any(matchPattern);
        return this._scan_act(castFn, 'scan', null, cursor, matchPattern, matchCount);
    }
    sscan(key, cursor, matchPattern, matchCount, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._scan_act(castFn, 'sscan', key, cursor, matchPattern, matchCount);
    }
    hscan(key, cursor, matchPattern, matchCount, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._scan_act(castFn, 'hscan', key, cursor, matchPattern, matchCount);
    }
    zscan(key, cursor, matchPattern, matchCount, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._scan_act(castFn, 'zscan', key, cursor, matchPattern, matchCount);
    }
    geoadd(key, ...LngLatMembers) {
        key = this._fix_prefix_any(key);
        LngLatMembers.unshift('geoadd', key);
        return this.send(...LngLatMembers).send(castNumber);
    }
    geodist(key, m1, m2, unit) {
        key = this._fix_prefix_any(key);
        var args = ['geodist', key, m1, m2];
        if (unit) {
            args.push(unit);
        }
        return this.send(...args).wait(castNumber);
    }
    geohash(key, ...members) {
        key = this._fix_prefix_any(key);
        members.unshift('geohash', key);
        return this.send(...members).wait(castStrs);
    }
    geopos(key, ...members) {
        key = this._fix_prefix_any(key);
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
        key = this._fix_prefix_any(key);
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
        key = this._fix_prefix_any(key);
        var args = ['georadiusbymember', key, member, radius, unit];
        return this.send(...args).wait(castStrs);
    }
    lPush(key, ...vals) {
        key = this._fix_prefix_any(key);
        return this.send(CmdLpush, key, ...vals).wait(castNumber);
    }
    rPush(key, ...vals) {
        key = this._fix_prefix_any(key);
        return this.send(CmdRpush, key, ...vals).wait(castNumber);
    }
    lPushx(key, val) {
        key = this._fix_prefix_any(key);
        return this.send(CmdLpushx, key, val).wait(castNumber);
    }
    rPushx(key, val) {
        key = this._fix_prefix_any(key);
        return this.send(CmdRpushx, key, val).wait(castNumber);
    }
    lLen(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdLlen, key).wait(castNumber);
    }
    lPop(key, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this.send(CmdLpop, key).wait(castFn);
    }
    rPop(key, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this.send(CmdRpop, key).wait(castFn);
    }
    lIndex(key, offset, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this.send(CmdLindex, key, offset).wait(castFn);
    }
    lInsert(key, pivot, val, toBefore = true) {
        key = this._fix_prefix_any(key);
        return this.send(CmdLinsert, key, toBefore ? 'BEFORE' : 'AFTER', pivot, val).wait(castNumber);
    }
    lSet(key, index, val) {
        key = this._fix_prefix_any(key);
        return this.send(CmdLset, key, index, val).wait(castBool);
    }
    lRem(key, count, val) {
        key = this._fix_prefix_any(key);
        return this.send(CmdLrem, key, count, val).wait(castNumber);
    }
    lTrim(key, start, stop) {
        key = this._fix_prefix_any(key);
        return this.send(CmdLtrim, key, start, stop).wait(castNumber);
    }
    lRange(key, start, stop, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this.send(CmdLrange, key, start, stop).wait(castFn);
    }
    bLpop(key, timeout, castFn = castStr) {
        key = this._fix_prefix_any(key);
        var args = Array.isArray(key) ? [CmdBlpop, ...key, timeout] : [CmdBlpop, key, timeout];
        return this.send(...args).wait(castFn);
    }
    bRpop(key, timeout, castFn = castStr) {
        key = this._fix_prefix_any(key);
        var args = Array.isArray(key) ? [CmdBrpop, ...key, timeout] : [CmdBrpop, key, timeout];
        return this.send(...args).wait(castFn);
    }
    bRpopLpush(srcKey, destKey, timeout, castFn = castStr) {
        srcKey = this._fix_prefix_any(srcKey);
        destKey = this._fix_prefix_any(destKey);
        var args = [CmdBrpopLpush, srcKey, destKey, timeout];
        return this.send(...args).wait(castFn);
    }
    rPopLpush(srcKey, destKey, castFn = castStr) {
        srcKey = this._fix_prefix_any(srcKey);
        destKey = this._fix_prefix_any(destKey);
        return this.send(CmdRpopLpush, srcKey, destKey).wait(castFn);
    }
    hSet(key, field, val) {
        key = this._fix_prefix_any(key);
        return this.send(CmdHSet, key, field, val).wait(castNumber);
    }
    hSetNx(key, field, val) {
        key = this._fix_prefix_any(key);
        return this.send(CmdHSetNx, key, field, val).wait(castNumber);
    }
    hGet(key, field, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this.send(CmdHGet, key, field).wait(castFn);
    }
    hLen(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdHLen, key).wait(castNumber);
    }
    hDel(key, ...fields) {
        key = this._fix_prefix_any(key);
        fields = util.isArray(fields[0]) ? fields[0] : fields;
        return this.send(CmdHdel, ...fields).wait(castNumber);
    }
    hKeys(key, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this.send(CmdHKeys, key).wait(castFn);
    }
    hVals(key, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this.send(CmdHVals, key).wait(castFn);
    }
    hGetAll(key, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this.send(CmdHGetAll, key).wait(castFn);
    }
    hGetAllWrap(key, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        var a = this.send(CmdHGetAll, key).wait(castFn);
        var r = {};
        for (var i = 0; i < a.length; i += 2) {
            r[a[i].toString()] = a[i + 1];
        }
        return r;
    }
    hExists(key, field) {
        key = this._fix_prefix_any(key);
        return this.send(CmdHExists, key, field).wait(castBool);
    }
    hIncrBy(key, field, val, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this.send(CmdHIncrBy, key, field, val).wait(castFn);
    }
    hIncrByFloat(key, field, val) {
        key = this._fix_prefix_any(key);
        return this.send(CmdHIncrByFloat, key, field, val).wait(castNumber);
    }
    hMset(key, hashObj) {
        key = this._fix_prefix_any(key);
        var args = [CmdHMset, key];
        for (var k in hashObj) {
            args.push(k, hashObj[k]);
        }
        return this.send(...args).wait(castBool);
    }
    hMGet(key, fields, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        if (!fields || fields.length < 1)
            return [];
        return this.send(CmdHMget, key, ...fields).wait(castFn);
    }
    hMGetWrap(key, fields, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        if (!fields || fields.length < 1)
            return [];
        var a = this.send(CmdHMget, key, ...fields).wait(castFn);
        var r = {};
        for (var i = 0; i < fields.length; i++) {
            r[fields[i].toString()] = a[i];
        }
        return r;
    }
    sAdd(key, ...members) {
        key = this._fix_prefix_any(key);
        members = util.isArray(members[0]) ? members[0] : members;
        return this.send(CmdSadd, key, ...members).wait(castNumber);
    }
    sRem(key, ...members) {
        key = this._fix_prefix_any(key);
        members = util.isArray(members[0]) ? members[0] : members;
        return this.send(CmdSrem, key, ...members).wait(castNumber);
    }
    sCard(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdScard, key).wait(castNumber);
    }
    sPop(key, num = 1, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this.send(CmdSpop, key, num).wait(castFn);
    }
    sRandmember(key, num = 1, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this.send(CmdSrandmember, key, num).wait(castFn);
    }
    sIsmember(key, member) {
        key = this._fix_prefix_any(key);
        return this.send(CmdSismember, key, member).wait(castBool);
    }
    sDiff(keys, castFn = castStrs) {
        keys = this._fix_prefix_any(keys);
        return this.send(CmdSdiff, ...keys).wait(castFn);
    }
    sDiffStore(destKey, keys) {
        keys.unshift(destKey);
        keys = this._fix_prefix_any(keys);
        return this.send(CmdSdiffStore, destKey, ...keys).wait(castNumber);
    }
    sInter(keys, castFn = castStrs) {
        keys = this._fix_prefix_any(keys);
        return this.send(CmdSinter, ...keys).wait(castFn);
    }
    sInterStore(destKey, keys) {
        keys.unshift(destKey);
        keys = this._fix_prefix_any(keys);
        return this.send(CmdSinterStore, ...keys).wait(castNumber);
    }
    sUnion(keys, castFn = castStrs) {
        keys = this._fix_prefix_any(keys);
        return this.send(CmdSunion, ...keys).wait(castFn);
    }
    sUnionStore(destKey, keys) {
        keys.unshift(destKey);
        keys = this._fix_prefix_any(keys);
        return this.send(CmdSunionStore, ...keys).wait(castNumber);
    }
    sMembers(key, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this.send(CmdSmembers, key).wait(castFn);
    }
    sMove(sourceKey, destKey, member) {
        var keys = [sourceKey, destKey];
        keys = this._fix_prefix_any(keys);
        return this.send(CmdSmove, ...keys, member).wait(castNumber);
    }
    //opts = [NX|XX] [CH] [INCR]
    zAdd(key, opts, ...score2members) {
        key = this._fix_prefix_any(key);
        var smsArr = score2members;
        if (!opts || opts.length < 1) {
            return this.send(CmdZadd, key, ...smsArr).wait(castNumber);
        }
        return this.send(CmdZadd, key, opts.join(''), ...smsArr).wait(castNumber);
    }
    //opts = [NX|XX] [CH] [INCR]
    zAddByKV(key, sms, opts) {
        key = this._fix_prefix_any(key);
        var smsArr = toZsetArray(sms, []);
        if (!opts || opts.length < 1) {
            return this.send(CmdZadd, key, ...smsArr).wait(castNumber);
        }
        return this.send(CmdZadd, key, opts.join(''), ...smsArr).wait(castNumber);
    }
    //opts = [NX|XX] [CH] [INCR]
    zAddOne(key, member, score, opts) {
        key = this._fix_prefix_any(key);
        if (!opts || opts.length < 1) {
            return this.send(CmdZadd, key, score, member).wait(castNumber);
        }
        return this.send(CmdZadd, key, opts.join(''), score, member).wait(castNumber);
    }
    zIncrBy(key, member, increment, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZincrBy, key, increment, member).wait(castFn);
    }
    zCard(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZcard, key).wait(castNumber);
    }
    zCount(key, min, max) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZcount, key, min, max).wait(castNumber);
    }
    zLexCount(key, min, max) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZlexcount, key, min, max).wait(castNumber);
    }
    zScore(key, member, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZscore, key, member).wait(castFn);
    }
    zRank(key, member) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZrank, key, member).wait(castNumber);
    }
    zRevRank(key, member) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZrevRank, key, member).wait(castNumber);
    }
    zRem(key, ...members) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZrem, key, ...members).wait(castNumber);
    }
    zRemByLex(key, min, max) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZremRangeByLex, key, min, max).wait(castNumber);
    }
    zRemByScore(key, min, max) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZremRangeByScore, key, min, max).wait(castNumber);
    }
    zRemByRank(key, start, stop) {
        key = this._fix_prefix_any(key);
        return this.send(CmdZremRangeByRank, key, start, stop).wait(castNumber);
    }
    _z_act(castFn, scorePv, args) {
        if (scorePv == 0) {
            return this.send(...args).wait(castFn);
        }
        var r = this.send(...args).wait();
        var list = [];
        // if(scorePv==1){
        for (var i = 0; i < r.length; i += 2) {
            var member = r[i].toString();
            var score = Number(r[i + 1].toString());
            list.push({ member: member, score: score });
        }
        // }else{
        //     for(var i=0;i<r.length;i+=2){
        //         var member=r[i+1].toString();
        //         var score=Number(r[i].toString());
        //         list.push({member:member,score:score});
        //     }
        // }
        return list;
    }
    zPopMin(key, num = 1, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZpopmin, key, num]);
    }
    zPopMax(key, num = 1, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZpopmax, key, num]);
    }
    zRange(key, start, stop, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._z_act(castFn, 0, [CmdZrange, key, start, stop]);
    }
    zRangeWithscore(key, start, stop, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZrange, key, start, stop, "WITHSCORES"]);
    }
    zRevRange(key, start, stop, withScore, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._z_act(castFn, 0, [CmdZrevRange, key, start, stop]);
    }
    zRevRangeWithscore(key, start, stop, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZrevRange, key, start, stop, "WITHSCORES"]);
    }
    zRangeByScore(key, min, max, opts = { withScore: false }, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        var args = [CmdZrangeByScore, key, Math.min(min, max), Math.max(min, max)];
        if (opts.limit) {
            args.push('LIMIT', opts.limit.offset, opts.limit.count);
        }
        if (opts.withScore) {
            args.push("WITHSCORES");
        }
        return this._z_act(castFn, opts.withScore ? 1 : 0, args);
    }
    zRevRangeByScore(key, min, max, opts = { withScore: false }, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        var args = [CmdZrevrangeByScore, key, Math.max(min, max), Math.min(min, max)];
        if (opts.limit) {
            args.push('LIMIT', opts.limit.offset, opts.limit.count);
        }
        if (opts.withScore) {
            args.push("WITHSCORES");
        }
        return this._z_act(castFn, opts.withScore ? 1 : 0, args);
    }
    bzPopMin(key, timeout = 0, castFn = castStr) {
        key = this._fix_prefix_any(key);
        var args = Array.isArray(key) ? [CmdBzPopMin, ...key, timeout] : [CmdBzPopMin, key, timeout];
        var r = this.send(...args).wait();
        r[0] = r[0].toString();
        r[1] = Number(r[1].toString());
        r[2] = castFn(r[2]);
        return r;
    }
    bzPopMax(key, timeout = 0, castFn = castStr) {
        key = this._fix_prefix_any(key);
        var args = Array.isArray(key) ? [CmdBzPopMax, ...key, timeout] : [CmdBzPopMax, key, timeout];
        var r = this.send(...args).wait();
        r[0] = r[0].toString();
        r[1] = Number(r[1].toString());
        r[2] = castFn(r[2]);
        return r;
    }
    pfAdd(key, ...elements) {
        var keys = util.isArray(elements[0]) ? elements[0] : elements;
        keys = this._fix_prefix_any(keys);
        return this.send(CmdPfadd, ...keys).wait(castNumber);
    }
    pfCount(key) {
        key = this._fix_prefix_any(key);
        return this.send(CmdPfcount, key).wait(castNumber);
    }
    pfMerge(destKey, ...sourceKeys) {
        var keys = util.isArray(sourceKeys[0]) ? sourceKeys[0] : sourceKeys;
        keys.unshift(destKey);
        keys = this._fix_prefix_any(sourceKeys);
        return this.send(CmdPfmerge, ...keys).wait(castBool);
    }
    publish(channel, data) {
        return this.send(CmdPublish, channel, data).wait(castNumber);
    }
    _real_sub(cmd, key, fn, isSubscribe) {
        this.pre_sub();
        var r = this.send(cmd, key).wait();
        var fns = isSubscribe ? this._subFn : this._psubFn;
        if (fns[key] == null) {
            fns[key] = [];
        }
        fns[key].push(fn);
        return r;
    }
    subscribe(key, fn) {
        // if(key==null||key.length<1||!util.isFunction(fn))return;
        key = this._fix_prefix_str(key);
        if (util.isArray(key)) {
            var arr = key;
            arr.forEach(e => {
                this._real_sub(CmdSubscribe, e, fn, true);
            });
        }
        else {
            this._real_sub(CmdSubscribe, key.toString(), fn, true);
        }
    }
    psubscribe(key, fn) {
        // if(key==null||key.length<1||!util.isFunction(fn))return;
        key = this._fix_prefix_str(key);
        if (util.isArray(key)) {
            var arr = key;
            arr.forEach(e => {
                this._real_sub(CmdPSubscribe, e, fn, false);
            });
        }
        else {
            this._real_sub(CmdPSubscribe, key.toString(), fn, false);
        }
    }
    _real_unsub(cmd, key, fn, fns) {
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
        key = this._fix_prefix_str(key);
        return this._real_unsub(CmdUnSubscribe, key, fn, this._subFn);
    }
    punsubscribe(key, fn) {
        key = this._fix_prefix_str(key);
        return this._real_unsub(CmdPUnSubscribe, key, fn, this._psubFn);
    }
    unsubscribeAll(key) {
        key = this._fix_prefix_str(key);
        var fns = this._subFn;
        var num = fns && fns[key] ? fns[key].length : 1;
        for (var i = 0; i < (num + 1); i++) {
            this._real_unsub(CmdUnSubscribe, key, null, fns);
        }
    }
    punsubscribeAll(key) {
        key = this._fix_prefix_str(key);
        var fns = this._psubFn;
        var num = fns && fns[key] ? fns[key].length : 1;
        for (var i = 0; i < (num + 1); i++) {
            this._real_unsub(CmdPUnSubscribe, key, null, fns);
        }
    }
    pre_sub() {
        if (!this._connected) {
            throw new redis_errors_1.RedisError("io_error");
        }
        if (!this._sub_backs) {
            if (this._mult_backs) {
                throw new redis_errors_1.RedisError("in_mult_exec");
            }
            if (PipeWrap.has()) {
                throw new redis_errors_1.RedisError("in_pipeline_ctx");
            }
            if (this._backs.length > 0) {
                this._backs[this._backs.length - 1].wait();
            }
            this._sub_backs = [];
            this._subFn = {};
            this._psubFn = {};
        }
    }
    after_unsub() {
        if (Object.keys(this._subFn).length < 1 && Object.keys(this._psubFn).length < 1) {
            if (this._sub_backs.length > 0) {
                this._sub_backs[this._sub_backs.length - 1].wait();
                this.after_unsub();
                return;
            }
            this._sub_backs = null;
            this._subFn = null;
            this._psubFn = null;
        }
    }
    pre_sub_onConnect() {
        var subFn = this._subFn;
        var psubFn = this._psubFn;
        var had = (subFn && Object.keys(subFn).length > 0) || (psubFn && Object.keys(psubFn).length > 0);
        this._sub_backs = null;
        this._subFn = null;
        this._psubFn = null;
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
                this._subFn = subFn;
                this._psubFn = psubFn;
            }
        }
    }
    _on_subReply(reply) {
        if (!util.isArray(reply)) {
            if (RET_OK.compare(reply) == 0) {
                this._sub_backs.shift().then(true);
            }
            else if (RET_PONG.compare(reply) == 0) {
                this._sub_backs.shift().then('PONG');
            }
        }
        else if (CmdMessage.compare(reply[0]) == 0) {
            var channel = reply[1].toString();
            this._subFn[channel].forEach(f => {
                f(reply[2], channel);
            });
        }
        else if (CmdPMessage.compare(reply[0]) == 0) {
            var channel = reply[1].toString();
            this._psubFn[channel].forEach(f => {
                f(reply[2], channel);
            });
        }
        else {
            if (CmdUnSubscribe.compare(reply[0]) == 0) {
                this._sub_backs.shift().then(reply.length > 2 ? parseInt(reply[2].toString()) : 0);
            }
            else if (CmdPUnSubscribe.compare(reply[0])) {
                this._sub_backs.shift().then(reply.length > 2 ? parseInt(reply[2].toString()) : 0);
            }
            else if (RET_PONG.compare(reply[0]) == 0) {
                this._sub_backs.shift().then('pong');
            }
            else {
                this._sub_backs.shift().then(reply);
            }
        }
    }
    _fix_prefix_str(k) {
        if (!this._prefix.buf) {
            return k;
        }
        if (util.isArray(k)) {
            var b = k;
            b.forEach((k, i, a) => {
                a[i] = this._prefix.str + k;
            });
            return k;
        }
        return this._prefix.str + k;
    }
    _fix_prefix_any(k) {
        if (!this._prefix.buf) {
            return k;
        }
        if (util.isArray(k)) {
            var b = k;
            b.forEach((k, i, a) => {
                if (util.isBuffer(k)) {
                    a[i] = Buffer.concat([this._prefix.buf, k]);
                }
                else {
                    a[i] = Buffer.from(this._prefix.str + k);
                }
            });
            return k;
        }
        if (util.isBuffer(k)) {
            return Buffer.concat([this._prefix.buf, k]);
        }
        return Buffer.from(this._prefix.str + k);
    }
}
exports.Redis = Redis;
class PipeWrap {
    constructor() {
        //请求命令缓存
        this.commands = []; //pipeline_command_cache
        //响应处理缓存
        this.casts = []; //pipeline_convert
    }
    static has() {
        return coroutine.current().hasOwnProperty(PipeWrap.KEY);
    }
    static start() {
        if (!coroutine.current().hasOwnProperty(PipeWrap.KEY)) {
            coroutine.current()[PipeWrap.KEY] = new PipeWrap();
        }
        return coroutine.current()[PipeWrap.KEY];
    }
    static get() {
        return coroutine.current()[PipeWrap.KEY];
    }
    static finish() {
        var v = coroutine.current()[PipeWrap.KEY];
        delete coroutine.current()[PipeWrap.KEY];
        return v;
    }
}
PipeWrap.KEY = "$redis_pipe";
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
function deepCastStrs(r) {
    if (util.isArray(r)) {
        r.forEach((v, k, a) => {
            if (util.isBuffer(v)) {
                a[k] = v.toString();
            }
            else if (util.isArray(v)) {
                a[k] = deepCastStrs(v);
            }
        });
    }
    return r;
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
function castBigInts(bufs) {
    bufs.forEach((v, k, a) => {
        if (v != null) {
            a[k] = global["BigInt"](v.toString());
        }
    });
    return bufs;
}
function castNumbers(bufs) {
    bufs.forEach((v, k, a) => {
        if (v != null) {
            var s = v.toString();
            var n = Number(s);
            a[k] = isNaN(n) ? s : n;
        }
    });
    return bufs;
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
Redis["castBigInts"] = castBigInts;
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
const RET_PONG = Buffer.from('pong');
const RET_OK = Buffer.from('OK');
const CmdDump = Buffer.from('dump');
const CmdTouch = Buffer.from('touch');
const CmdMove = Buffer.from('move');
const CmdRandomkey = Buffer.from('randomkey');
const CmdRename = Buffer.from('rename');
const CmdRenameNX = Buffer.from('renamenx');
const CmdSubscribe = Buffer.from('subscribe');
const CmdPSubscribe = Buffer.from('psubscribe');
const CmdUnSubscribe = Buffer.from('unsubscribe');
const CmdPUnSubscribe = Buffer.from('punsubscribe');
const CmdMessage = Buffer.from('message');
const CmdPMessage = Buffer.from('pmessage');
const CmdQuit = Buffer.from('quit');
const CmdPing = Buffer.from('ping');
const CmdEcho = Buffer.from('echo');
const CmdSwapdb = Buffer.from('swapdb');
const CmdAuth = Buffer.from('auth');
const CmdSelect = Buffer.from('select');
const CmdPublish = Buffer.from('publish');
const CmdExists = Buffer.from('exists');
const CmdKeys = Buffer.from('keys');
const CmdType = Buffer.from('type');
const CmdDel = Buffer.from('del');
const CmdUnlink = Buffer.from('unlink');
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
const CmdBitpos = Buffer.from('bitpos');
const CmdBitop = Buffer.from('bitop');
const CmdGetbit = Buffer.from('getbit');
const CmdSetbit = Buffer.from('setbit');
const CmdSubstr = Buffer.from('substr');
const CmdStrlen = Buffer.from('strlen');
const CmdSetRange = Buffer.from('setrange');
const CmdGetRange = Buffer.from('getrange');
const CmdMGet = Buffer.from('mget');
const CmdGetSet = Buffer.from('getset');
const CmdDecr = Buffer.from('decr');
const CmdIncr = Buffer.from('incr');
const CmdDecrBy = Buffer.from('decrby');
const CmdIncrBy = Buffer.from('incrby');
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
const CmdHSet = Buffer.from('hset');
const CmdHSetNx = Buffer.from('hsetnx');
const CmdHGet = Buffer.from('hget');
const CmdHLen = Buffer.from('hlen');
const CmdHdel = Buffer.from('hdel');
const CmdHKeys = Buffer.from('hkeys');
const CmdHVals = Buffer.from('hvals');
const CmdHGetAll = Buffer.from('hGetAll');
const CmdHExists = Buffer.from('hExists');
const CmdHIncrBy = Buffer.from('hIncrBy');
const CmdHIncrByFloat = Buffer.from('hIncrByFloat');
const CmdHMget = Buffer.from('hmget');
const CmdHMset = Buffer.from('hmset');
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
const CmdZrevRank = Buffer.from('zrevrank');
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
const CmdPfcount = Buffer.from('pfcount');
const CmdPfadd = Buffer.from('pfadd');
const CmdPfmerge = Buffer.from('pfmerge');
const CmdTime = Buffer.from('time');
const CmdInfo = Buffer.from('info');
const CmdClient = Buffer.from('client');
const CmdSlowlog = Buffer.from('slowlog');
const CmdConfig = Buffer.from('config');
// const CmdShutdown=Buffer.from('shutdown');
// const CmdBgsave=Buffer.from('bgsave');
