"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * redis-客户端类
 */
const events_1 = require("events");
const util = require("util");
const coroutine = require("coroutine");
const net = require("net");
const io = require("io");
const QueryString = require("querystring");
const url = require("url");
class SockStat {
}
SockStat.INIT = 0;
SockStat.CONNECTING = 1;
SockStat.OPEN = 2;
SockStat.CLOSED = 3;
/**
 * 相关事件
 */
exports.RedisEvent = {
    onOpen: "onOpen",
    onLost: "onLost",
    onClose: "onClose"
};
/**RedisError
 * Redis client
 * "redis://127.0.0.1:6379"
 * "redis://authpwd@127.0.0.1:6379?db=1&prefix=XX:"
 * "redis://127.0.0.1:6379?db=1&prefix=XX:&auth=authpwd"
 */
class Redis extends events_1.EventEmitter {
    /**
     *
     * @param conf 配置
     * @param openConnType 构造函数中打开接方式：0-不进行连接，1-当前fiber连接，2-新fiber连接
     */
    constructor(conf = "redis://127.0.0.1:6379", openConnType = 1) {
        super();
        this._waitReconnect = true; //发送指令时,如果在重连中是否等待重连
        this._prefix = { str: "", buf: null };
        this._temp_cmds = [];
        if (conf === null) {
            return;
        }
        this._opts = util.isString(conf) ? uriToConfig(conf + "") : conf;
        this.prefix = this._opts.prefix;
        this._onOpen = new coroutine.Event(false);
        this._sendBufs = [];
        this._sendEvt = new coroutine.Event(false);
        this._connectLock = new coroutine.Semaphore(1);
        let self = this;
        self._state = SockStat.INIT;
        if (openConnType == 2) {
            self._state = SockStat.CONNECTING;
            coroutine.start(() => {
                self.connect();
            });
        }
        else if (openConnType == 1) {
            self.connect();
        }
    }
    connect() {
        return this._do_conn();
    }
    /**
     * 发送指令时,如果在重连中是否等待重连【默认为true】，需要配合配置【autoReconnect】一同生效
     */
    get waitReconnect() {
        return this._waitReconnect;
    }
    set waitReconnect(b) {
        this._waitReconnect = b;
    }
    /**
     * 所有发送key的前缀
     */
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
        this._connectLock.acquire();
        try {
            if (this._state == SockStat.OPEN && this._socket) {
                return;
            }
            this._state = SockStat.CONNECTING;
            var sock = new net.Socket();
            let opts = this._opts;
            sock.timeout = opts.timeout;
            sock.connect(opts.host, opts.port);
            var buf = new io.BufferedStream(sock);
            buf.EOL = "\r\n";
            opts.auth && this._pre_command(sock, buf, 'auth', opts.auth);
            opts.db > 0 && this._pre_command(sock, buf, 'select', opts.db);
            this._socket = sock;
            this._backs = [];
            this._state = SockStat.OPEN;
            this._pre_Fibers();
            this._pre_sub_onConnect();
            this._onOpen.set();
            this._reader.run();
            this.emit(exports.RedisEvent.onOpen);
        }
        catch (e) {
            this._state = SockStat.CLOSED;
            try {
                sock.close();
            }
            catch (e2) {
            }
            throw e;
        }
        finally {
            this._connectLock.release();
        }
        return this;
    }
    _pre_Fibers() {
        let T = this;
        const local_port = T._socket.localPort;
        T._socket.timeout = -1;
        T._sender = coroutine.start(() => {
            let sock = T._socket, buf;
            while (T._socket === sock && T._state == SockStat.OPEN) {
                if (T._sendBufs.length > 0) {
                    buf = T._sendBufs.length > 1 ? Buffer.concat(T._sendBufs) : T._sendBufs[0];
                    T._sendBufs.length = 0;
                    try {
                        sock.send(buf);
                    }
                    catch (e) {
                        console.error("Redis|on_send", local_port, e);
                        coroutine.start(() => {
                            T._on_err(e, true);
                        });
                        break;
                    }
                }
                else {
                    T._sendEvt.clear();
                    T._sendEvt.wait();
                }
            }
        });
        T._reader = new RespReader(T._socket, {
            check: (sock) => {
                return T._socket === sock && T._state == SockStat.OPEN;
            },
            onClose: T._on_lost.bind(T),
            onErr: T._on_err.bind(T),
            replyError: err => {
                // err=String(err); return err.includes("NOAUTH") || err.includes("rpc");
                // return String(err).includes("wrong number")==false;//除了参数不对，全部认为是致命错误
                if (String(err).includes("wrong number") == false) {
                    console.error("Redis|on_reply_error|1", local_port, err);
                    T._on_err(err, true);
                    return;
                }
                try {
                    if (T._sub_backs) {
                        T._sub_backs.shift().fail(new RedisError(err));
                    }
                    else {
                        T._backs.shift().fail(new RedisError(err));
                    }
                }
                catch (exx) {
                    // console.error("--->>>", (reply||"null").toString(),exx)
                    console.error("Redis|on_reply_error|0", local_port, exx);
                }
            },
            replyData: reply => {
                try {
                    if (T._sub_backs) {
                        T._on_subReply(reply);
                    }
                    else {
                        T._backs.shift().then(reply);
                    }
                }
                catch (exx) {
                    // console.error("--->>>", (reply||"null").toString(),exx)
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
            throw new RedisError("io-err");
        }
        if (str.indexOf("invalid") > 0) {
            sock.close();
            throw new RedisError("ERR invalid password");
        }
    }
    _on_lost() {
        this._on_err(new Error("io_error"), true);
    }
    _on_err(e, deadErr) {
        console.error("Redis|_on_err|%s", this._opts.host + ":" + this._opts.port + "=" + this._state, e);
        if (this._socket == null || (this._state != SockStat.OPEN && this._state != SockStat.CONNECTING)) {
            console.error("Redis|_on_err|return");
            return;
        }
        this._try_drop_worker();
        this._try_drop_cbks(e);
        this._try_auto_reconn();
    }
    _try_drop_cbks(e, isClose = false) {
        var backs = this._backs, sub_backs = this._sub_backs;
        this._backs = [];
        this._sub_backs = null;
        if (sub_backs) {
            backs = backs.concat(...sub_backs);
        }
        try {
            backs.forEach(operation => {
                operation.fail(e);
            });
            if (sub_backs) {
                sub_backs.forEach(operation => {
                    operation.fail(e);
                });
            }
        }
        catch (_e_) {
        }
        this._backs = [];
        this._sub_backs = null;
        this._mult_backs = null;
        this.emit(isClose ? exports.RedisEvent.onClose : exports.RedisEvent.onLost);
    }
    _try_drop_worker() {
        try {
            this._state = SockStat.CLOSED;
            this._sendBufs.length = 0;
            this._sendEvt.set();
            this._reader && this._reader.kill();
            try {
                this._socket.close();
            }
            catch (e) {
            }
            this._onOpen.set();
            this._onOpen.clear();
        }
        catch (e) {
        }
    }
    //开始重连
    _try_auto_reconn() {
        if (this._opts.autoReconnect && !this._killed && !this._reconIng) {
            this._try_drop_worker();
            this._reconIng = true;
            let i = 0;
            while (this._state != SockStat.OPEN && !this._killed) {
                try {
                    this._do_conn();
                    return;
                }
                catch (e) {
                    console.error("Redis|auto_reconn", i, this._opts.host + ":" + this._opts.port, e);
                    try {
                        this._socket.close();
                    }
                    catch (e) {
                    }
                }
                this._state = SockStat.CONNECTING;
                i++;
                coroutine.sleep(Math.min(i * 5, 500));
            }
        }
    }
    close() {
        this._killed = true;
        this._state = SockStat.CLOSED;
        var sock = this._socket;
        this._try_drop_worker();
        this._socket = null;
        try {
            sock.close();
        }
        catch (e) {
        }
        this._try_drop_cbks(new Error("io_close"), true);
    }
    _is_in_pipeline() {
        return false;
    }
    _before_send() {
        if (this._killed) {
            throw new RedisError("io_had_closed");
        }
        if (this._state == SockStat.CONNECTING) {
            this._onOpen.wait(); //等待链接
        }
        if (this._state != SockStat.OPEN) {
            throw new RedisError("io_error");
        }
    }
    _tmp_send(...args) {
        this._temp_cmds.push(encodeCommand(args));
        return this;
    }
    _wait(convert) {
        this._before_send();
        let backs = this._backs;
        if (this._sub_backs) {
            backs = this._sub_backs;
        }
        else if (this._mult_backs) {
            this._mult_backs.push(convert);
            convert = castStr;
        }
        let evt = new OptEvent();
        backs.push(evt);
        this._sendBufs.push(...this._temp_cmds);
        this._sendEvt.set();
        this._temp_cmds.length = 0;
        return evt.wait(convert);
    }
    rawCommand(cmd, ...args) {
        // console.log("...>",cmd,...args);
        return this._tmp_send(...arguments)._wait();
    }
    ping() {
        return this._tmp_send(CmdPing)._wait(castStr);
    }
    quit() {
        var t = this._tmp_send(CmdQuit);
        t._killed = true;
        try {
            t._wait(castBool);
        }
        catch (e) {
        }
        finally {
            t.close();
        }
        return true;
    }
    echo(s) {
        return this._tmp_send(CmdEcho, s)._wait(castStr);
    }
    eval(script, keys, args = null, castFn = castAuto) {
        if (args && args.length > 0) {
            return this._tmp_send(CmdEval, script, keys.length, ...keys, ...args)._wait(castFn);
        }
        return this._tmp_send(CmdEval, script, keys.length, ...keys)._wait(castFn);
    }
    eval2(script, keysNum, ...keys_args) {
        return this._tmp_send(CmdEval, script, keysNum, ...keys_args)._wait(castAuto);
    }
    evalsha(sha1, keys, args = null, castFn = castAuto) {
        if (args && args.length > 0) {
            return this._tmp_send(CmdEvalSha, sha1, keys.length, ...keys, ...args)._wait(castFn);
        }
        return this._tmp_send(CmdEvalSha, sha1, keys.length, ...keys)._wait(castFn);
    }
    evalsha2(sha1, keysNum, ...keys_args) {
        return this._tmp_send(CmdEvalSha, sha1, keysNum, ...keys_args)._wait(castAuto);
    }
    scriptLoad(script) {
        return this._tmp_send(CmdScript, 'load', script)._wait(castStr);
    }
    scriptExists(...sha1s) {
        return this._tmp_send(CmdScript, 'exists', ...sha1s)._wait(castBools);
    }
    scriptFlush() {
        return this._tmp_send(CmdScript, 'flush')._wait(castBool);
    }
    scriptKill() {
        return this._tmp_send(CmdScript, 'kill')._wait(castBool);
    }
    scriptDebug(type) {
        return this._tmp_send(CmdScript, 'debug', type)._wait(castBool);
    }
    swapdb(a, b) {
        return this._tmp_send(CmdSwapdb, a, b)._wait(castBool);
    }
    select(db) {
        return this._tmp_send(CmdSelect, db)._wait(castBool);
    }
    info(option) {
        var args = option && option.length > 0 ? [CmdInfo, option] : [CmdInfo];
        return this._tmp_send(...args)._wait(castStr);
    }
    client(subCommand, ...args) {
        return this._tmp_send(CmdClient, subCommand, ...args)._wait(castStr);
    }
    time() {
        return this._tmp_send(CmdTime)._wait(castNumbers);
    }
    slowlog(subCommand, ...subArgs) {
        return this._tmp_send(CmdSlowlog, ...arguments)._wait(deepCastStrs);
    }
    slowlogLen() {
        return this.slowlog("len");
    }
    slowlogGet(n) {
        return this.slowlog("get", n);
    }
    config(subCommand, ...subArgs) {
        return this._tmp_send(CmdConfig, subCommand, ...arguments)._wait(deepCastStrs);
    }
    _pre_trans() {
        if (this._sub_backs) {
            throw new RedisError("in_subscribe_context");
        }
    }
    watch(...keys) {
        this._pre_trans();
        keys = Array.isArray(keys[0]) ? keys[0] : keys;
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdWatch, ...keys)._wait(castBool);
    }
    unwatch() {
        this._pre_trans();
        return this._tmp_send(CmdUnWatch)._wait(castBool);
    }
    multi() {
        this._pre_trans();
        if (!this._mult_backs) {
            this._mult_backs = [];
            try {
                this._tmp_send(CmdMulti)._wait(castBool);
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
        this._pre_trans();
        let fns = this._mult_backs;
        this._mult_backs = null;
        return this._tmp_send(CmdExec)._wait(a => {
            if (a != null) {
                a.forEach((v, k, o) => {
                    o[k] = v != null && fns[k] ? fns[k](v) : v;
                });
            }
            return a;
        });
    }
    discard() {
        return this._tmp_send(CmdDiscard)._wait(castBool);
    }
    _assert_normal() {
        if (this._mult_backs || this._sub_backs) {
            throw new RedisError("in_mult_ctx or in_subscribe_ctx");
        }
    }
    pipeline(fn) {
        this._assert_normal();
        let p = new RedisPipeLine(this);
        fn(p);
        return p.pipeSubmit();
    }
    pipeOpen() {
        this._assert_normal();
        return new RedisPipeLine(this);
    }
    pipeSubmit() {
        throw "redis_not_in_pipeline";
    }
    _pipeline_submit_bridge(commands, casts) {
        this._assert_normal();
        this._before_send();
        var events = new PipelineOptEvent(casts);
        casts.forEach(e => {
            this._backs.push(events);
        });
        this._sendBufs.push(...commands);
        this._sendEvt.set();
        return events.waitAll(true);
    }
    keys(pattern) {
        pattern = this._fix_prefix_any(pattern);
        return this._tmp_send(CmdKeys, pattern)._wait(castStrs);
    }
    exists(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdExists, key)._wait(castBool);
    }
    type(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdType, key)._wait(castStr);
    }
    rename(key, newkey) {
        key = this._fix_prefix_any(key);
        newkey = this._fix_prefix_any(newkey);
        return this._tmp_send(CmdRename, key, newkey)._wait(castBool);
    }
    renameNX(key, newkey) {
        key = this._fix_prefix_any(key);
        newkey = this._fix_prefix_any(newkey);
        return this._tmp_send(CmdRenameNX, key, newkey)._wait(castBool);
    }
    dump(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdDump, key)._wait(castStr);
    }
    touch(...keys) {
        keys = Array.isArray(keys[0]) ? keys[0] : keys;
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdTouch, ...keys)._wait(castNumber);
    }
    move(key, toDb) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdMove, key, toDb)._wait(castNumber);
    }
    randomKey() {
        return this._tmp_send(CmdRandomkey)._wait(castStr);
    }
    del(...keys) {
        keys = Array.isArray(keys[0]) ? keys[0] : keys;
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdDel, ...keys)._wait(castNumber);
    }
    unlink(...keys) {
        keys = Array.isArray(keys[0]) ? keys[0] : keys;
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdUnlink, ...keys)._wait(castNumber);
    }
    expire(key, ttl) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdExpire, key, ttl)._wait(castBool);
    }
    pexpire(key, ttl) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdPexpire, key, ttl)._wait(castBool);
    }
    pttl(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdPttl, key)._wait(castNumber);
    }
    ttl(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdTtl, key)._wait(castNumber);
    }
    persist(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdPersist, key)._wait(castBool);
    }
    set(key, val, ttl = -1) {
        key = this._fix_prefix_any(key);
        if (ttl < 0) {
            return this._tmp_send(CmdSet, key, val)._wait(castBool);
        }
        return this._tmp_send(CmdSet, key, val, CmdOptEX, ttl)._wait(castBool);
    }
    // set if not exists
    add(key, val, ttl = -1) {
        return this.setNX(key, val, ttl);
    }
    // set if not exists
    setNX(key, val, ttl = -1) {
        key = this._fix_prefix_any(key);
        if (ttl < 0) {
            return this._tmp_send(CmdSet, key, val, CmdOptNX)._wait(castBool);
        }
        return this._tmp_send(CmdSet, key, val, CmdOptEX, ttl, CmdOptNX)._wait(castBool);
    }
    // set if exists
    setXX(key, val, ttl = -1) {
        key = this._fix_prefix_any(key);
        if (ttl < 0) {
            return this._tmp_send(CmdSet, key, val, CmdOptXX)._wait(castBool);
        }
        return this._tmp_send(CmdSet, key, val, CmdOptEX, ttl, CmdOptXX)._wait(castBool);
    }
    mset(...kvs) {
        kvs = kvs.length == 1 ? toArray(kvs[0], []) : kvs;
        for (var i = 0; i < kvs.length; i += 2) {
            kvs[i] = this._fix_prefix_any(kvs[i]);
        }
        return this._tmp_send(CmdMSet, ...kvs)._wait(castBool);
    }
    msetNX(...kvs) {
        kvs = kvs.length == 1 ? toArray(kvs[0], []) : kvs;
        for (var i = 0; i < kvs.length; i += 2) {
            kvs[i] = this._fix_prefix_any(kvs[i]);
        }
        return this._tmp_send(CmdMSetNX, ...kvs)._wait(castBool);
    }
    append(key, val) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdAppend, key, val)._wait(castBool);
    }
    setRange(key, offset, val) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdSetRange, key, offset, val)._wait(castNumber);
    }
    getRange(key, start, end, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdGetRange, key, start, end)._wait(castFn);
    }
    substr(key, start, end, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdSubstr, key, start, end)._wait(castFn);
    }
    strlen(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdStrlen, key)._wait(castNumber);
    }
    get(key, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdGet, key)._wait(castFn);
    }
    mget(keys, castFn = castStrs) {
        var keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdMGet, ...keys)._wait(castFn);
    }
    mgetWrap(keys, castFn = castStrs) {
        var a = this.mget(keys, castFn);
        var r = {};
        keys.forEach((k, i) => {
            r[k] = a[i];
        });
        return r;
    }
    mgetWrap2(keys, fixKeyPathFn, castFn = castStrs) {
        var a = this.mget(keys.map(fixKeyPathFn), castFn);
        var r = {};
        keys.forEach((k, i) => {
            r[k] = a[i];
        });
        return r;
    }
    getSet(key, val, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdGetSet, key, val)._wait(castFn);
    }
    incr(key, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdIncr, key)._wait(castFn);
    }
    decr(key, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdDecr, key)._wait(castFn);
    }
    incrByFloat(key, step, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdIncrByFloat, key, step)._wait(castFn);
    }
    incrBy(key, step, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdIncrBy, key, step)._wait(castFn);
    }
    decrBy(key, step, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdDecrBy, key, step)._wait(castFn);
    }
    bitCount(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdBitcount, key)._wait(castNumber);
    }
    bitPos(key, start, end) {
        key = this._fix_prefix_any(key);
        if (arguments.length > 2) {
            return this._tmp_send(CmdBitpos, key, start, end)._wait(castNumber);
        }
        return this._tmp_send(CmdBitpos, key, start)._wait(castNumber);
    }
    bitOp(option, destkey, ...keys) {
        keys.unshift(destkey);
        keys = this._fix_prefix_any(keys);
        keys.unshift(option);
        return this._tmp_send(CmdBitop, ...keys)._wait(castNumber);
    }
    setBit(key, offset, val) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdSetbit, key, offset, val)._wait(castBool);
    }
    getBit(key, offset) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdGetbit, key, offset)._wait(castNumber);
    }
    _scan_act(parse, cmd, key, cursor, matchPattern, matchCount) {
        var args = cmd == 'scan' ? [cmd, cursor] : [cmd, key, cursor];
        if (matchPattern && matchPattern.length > 0) {
            args.push('MATCH', matchPattern);
        }
        if (Number.isInteger(matchCount)) {
            args.push('COUNT', matchCount);
        }
        return this._tmp_send(...args)._wait(a => {
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
        });
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
        return this._tmp_send(...LngLatMembers)._wait(castNumber);
    }
    geodist(key, m1, m2, unit) {
        key = this._fix_prefix_any(key);
        var args = ['geodist', key, m1, m2];
        if (unit) {
            args.push(unit);
        }
        return this._tmp_send(...args)._wait(castNumber);
    }
    geohash(key, ...members) {
        key = this._fix_prefix_any(key);
        members.unshift('geohash', key);
        return this._tmp_send(...members)._wait(castStrs);
    }
    geopos(key, ...members) {
        key = this._fix_prefix_any(key);
        members.unshift('geopos', key);
        var a = this._tmp_send(...members)._wait();
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
        var a = this._tmp_send(...args)._wait();
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
        return this._tmp_send(...args)._wait(castStrs);
    }
    _pre_block() {
        this._assert_normal();
    }
    lPush(key, ...vals) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdLpush, key, ...vals)._wait(castNumber);
    }
    rPush(key, ...vals) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdRpush, key, ...vals)._wait(castNumber);
    }
    lPushx(key, val) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdLpushx, key, val)._wait(castNumber);
    }
    rPushx(key, val) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdRpushx, key, val)._wait(castNumber);
    }
    lLen(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdLlen, key)._wait(castNumber);
    }
    lPop(key, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdLpop, key)._wait(castFn);
    }
    rPop(key, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdRpop, key)._wait(castFn);
    }
    lIndex(key, offset, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdLindex, key, offset)._wait(castFn);
    }
    lInsert(key, pivot, val, toBefore = true) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdLinsert, key, toBefore ? 'BEFORE' : 'AFTER', pivot, val)._wait(castNumber);
    }
    lSet(key, index, val) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdLset, key, index, val)._wait(castBool);
    }
    lRem(key, count, val) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdLrem, key, count, val)._wait(castNumber);
    }
    lTrim(key, start, stop) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdLtrim, key, start, stop)._wait(castNumber);
    }
    lRange(key, start, stop, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdLrange, key, start, stop)._wait(castFn);
    }
    bLpop(key, timeout, castFn = castStrs) {
        this._pre_block();
        key = this._fix_prefix_any(key);
        var args = Array.isArray(key) ? [CmdBlpop, ...key, timeout] : [CmdBlpop, key, timeout];
        return this._tmp_send(...args)._wait(castFn);
    }
    bRpop(key, timeout, castFn = castStrs) {
        this._pre_block();
        key = this._fix_prefix_any(key);
        var args = Array.isArray(key) ? [CmdBrpop, ...key, timeout] : [CmdBrpop, key, timeout];
        return this._tmp_send(...args)._wait(castFn);
    }
    bRpopLpush(srcKey, destKey, timeout, castFn = castStr) {
        this._pre_block();
        srcKey = this._fix_prefix_any(srcKey);
        destKey = this._fix_prefix_any(destKey);
        var args = [CmdBrpopLpush, srcKey, destKey, timeout];
        return this._tmp_send(...args)._wait(castFn);
    }
    rPopLpush(srcKey, destKey, castFn = castStr) {
        this._pre_block();
        srcKey = this._fix_prefix_any(srcKey);
        destKey = this._fix_prefix_any(destKey);
        return this._tmp_send(CmdRpopLpush, srcKey, destKey)._wait(castFn);
    }
    hSet(key, field, val) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdHSet, key, field, val)._wait(castNumber);
    }
    hSetNx(key, field, val) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdHSetNx, key, field, val)._wait(castNumber);
    }
    hGet(key, field, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdHGet, key, field)._wait(castFn);
    }
    hLen(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdHLen, key)._wait(castNumber);
    }
    hDel(key, ...fields) {
        key = this._fix_prefix_any(key);
        fields = Array.isArray(fields[0]) ? fields[0] : fields;
        return this._tmp_send(CmdHdel, key, ...fields)._wait(castNumber);
    }
    hKeys(key, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdHKeys, key)._wait(castFn);
    }
    hVals(key, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdHVals, key)._wait(castFn);
    }
    hGetAll(key, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdHGetAll, key)._wait(castFn);
    }
    hGetAllWrap(key, castFn = castStrs) {
        var a = this.hGetAll(key, castFn);
        var r = {};
        for (var i = 0; i < a.length; i += 2) {
            r[a[i].toString()] = a[i + 1];
        }
        return r;
    }
    hExists(key, field) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdHExists, key, field)._wait(castBool);
    }
    hIncrBy(key, field, val, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdHIncrBy, key, field, val)._wait(castFn);
    }
    hIncrByFloat(key, field, val) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdHIncrByFloat, key, field, val)._wait(castNumber);
    }
    hMset(key, hashObj) {
        key = this._fix_prefix_any(key);
        var args = [CmdHMset, key];
        for (var k in hashObj) {
            args.push(k, hashObj[k]);
        }
        return args.length > 2 ? this._tmp_send(...args)._wait(castBool) : false;
    }
    hMGet(key, fields, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        if (!fields || fields.length < 1)
            return [];
        return this._tmp_send(CmdHMget, key, ...fields)._wait(castFn);
    }
    hMGetWrap(key, fields, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        if (!fields || fields.length < 1)
            return [];
        var a = this._tmp_send(CmdHMget, key, ...fields)._wait(castFn);
        var r = {};
        for (var i = 0; i < fields.length; i++) {
            r[fields[i].toString()] = a[i];
        }
        return r;
    }
    sAdd(key, ...members) {
        key = this._fix_prefix_any(key);
        members = Array.isArray(members[0]) ? members[0] : members;
        return this._tmp_send(CmdSadd, key, ...members)._wait(castNumber);
    }
    sRem(key, ...members) {
        key = this._fix_prefix_any(key);
        members = Array.isArray(members[0]) ? members[0] : members;
        return this._tmp_send(CmdSrem, key, ...members)._wait(castNumber);
    }
    sCard(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdScard, key)._wait(castNumber);
    }
    sPop(key, num = 1, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdSpop, key, num)._wait(castFn);
    }
    sPopOne(key, castFn = castStr) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdSpop, key)._wait(castFn);
    }
    sRandMember(key, num = 1, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdSrandmember, key, num)._wait(castFn);
    }
    sIsMember(key, member) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdSismember, key, member)._wait(castBool);
    }
    sDiff(keys, castFn = castStrs) {
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdSdiff, ...keys)._wait(castFn);
    }
    sDiffStore(destKey, keys) {
        keys.unshift(destKey);
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdSdiffStore, destKey, ...keys)._wait(castNumber);
    }
    sInter(keys, castFn = castStrs) {
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdSinter, ...keys)._wait(castFn);
    }
    sInterStore(destKey, keys) {
        keys.unshift(destKey);
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdSinterStore, ...keys)._wait(castNumber);
    }
    sUnion(keys, castFn = castStrs) {
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdSunion, ...keys)._wait(castFn);
    }
    sUnionStore(destKey, keys) {
        keys.unshift(destKey);
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdSunionStore, ...keys)._wait(castNumber);
    }
    sMembers(key, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdSmembers, key)._wait(castFn);
    }
    sMove(sourceKey, destKey, member) {
        var keys = [sourceKey, destKey];
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdSmove, ...keys, member)._wait(castNumber);
    }
    //opts = [NX|XX] [CH] [INCR]
    zAdd(key, opts, ...score2members) {
        key = this._fix_prefix_any(key);
        var smsArr = score2members;
        if (!opts || opts.length < 1) {
            return this._tmp_send(CmdZadd, key, ...smsArr)._wait(castNumber);
        }
        return this._tmp_send(CmdZadd, key, opts.join(''), ...smsArr)._wait(castNumber);
    }
    //opts = [NX|XX] [CH] [INCR]
    zAddByKV(key, sms, opts) {
        key = this._fix_prefix_any(key);
        var smsArr = toZsetArray(sms, []);
        if (!opts || opts.length < 1) {
            return this._tmp_send(CmdZadd, key, ...smsArr)._wait(castNumber);
        }
        return this._tmp_send(CmdZadd, key, opts.join(''), ...smsArr)._wait(castNumber);
    }
    //opts = [NX|XX] [CH] [INCR]
    zAddOne(key, member, score, opts) {
        key = this._fix_prefix_any(key);
        if (!opts || opts.length < 1) {
            return this._tmp_send(CmdZadd, key, score, member)._wait(castNumber);
        }
        return this._tmp_send(CmdZadd, key, opts.join(''), score, member)._wait(castNumber);
    }
    zIncrBy(key, member, increment, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZincrBy, key, increment, member)._wait(castFn);
    }
    zCard(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZcard, key)._wait(castNumber);
    }
    zCount(key, min, max) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZcount, key, min, max)._wait(castNumber);
    }
    zLexCount(key, min, max) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZlexcount, key, min, max)._wait(castNumber);
    }
    zScore(key, member, castFn = castNumber) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZscore, key, member)._wait(castFn);
    }
    zRank(key, member) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZrank, key, member)._wait(castNumber);
    }
    zRevRank(key, member) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZrevRank, key, member)._wait(castNumber);
    }
    zRem(key, ...members) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZrem, key, ...members)._wait(castNumber);
    }
    zRemByLex(key, min, max) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZremRangeByLex, key, min, max)._wait(castNumber);
    }
    zRemByScore(key, min, max) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZremRangeByScore, key, min, max)._wait(castNumber);
    }
    zRemByRank(key, start, stop) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdZremRangeByRank, key, start, stop)._wait(castNumber);
    }
    _z_act(castFn, scorePv, args) {
        var r = this._tmp_send(...args)._wait(castFn);
        if (scorePv == 0) {
            return r;
        }
        var list = [];
        for (var i = 0; i < r.length; i += 2) {
            list.push({ member: r[i], score: Number(r[i + 1]) });
        }
        return list;
    }
    zRange(key, start, stop, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._z_act(castFn, 0, [CmdZrange, key, start, stop]);
    }
    zRangeWithscore(key, start, stop, castFn = castStrs) {
        key = this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZrange, key, start, stop, "WITHSCORES"]);
    }
    zRevRange(key, start, stop, castFn = castStrs) {
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
    zPopMin(key, num = 1, castFn = castAuto) {
        key = this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZpopmin, key, num]);
    }
    zPopMax(key, num = 1, castFn = castAuto) {
        key = this._fix_prefix_any(key);
        return this._z_act(castFn, 1, [CmdZpopmax, key, num]);
    }
    bzPopMin(key, timeout = 0, castFn = castAuto) {
        this._pre_block();
        key = this._fix_prefix_any(key);
        var args = Array.isArray(key) ? [CmdBzPopMin, ...key, timeout] : [CmdBzPopMin, key, timeout];
        return this._tmp_send(...args)._wait(castFn);
    }
    bzPopMax(key, timeout = 0, castFn = castAuto) {
        this._pre_block();
        key = this._fix_prefix_any(key);
        var args = Array.isArray(key) ? [CmdBzPopMax, ...key, timeout] : [CmdBzPopMax, key, timeout];
        return this._tmp_send(...args)._wait(castFn);
    }
    zUnionStore(destKey, numkeys, srcKeys, weights) {
        destKey = this._fix_prefix_any(destKey);
        let keys = this._fix_prefix_any(Array.isArray(srcKeys) ? srcKeys : [srcKeys]);
        if (weights && weights.length > 0) {
            return this._tmp_send(CmdZUNIONSTORE, destKey, numkeys, ...keys, "WEIGHTS", ...weights)._wait(castNumber);
        }
        return this._tmp_send(CmdZUNIONSTORE, destKey, numkeys, ...keys)._wait(castNumber);
    }
    zInterStore(destKey, numkeys, srcKeys, weights) {
        destKey = this._fix_prefix_any(destKey);
        let keys = this._fix_prefix_any(Array.isArray(srcKeys) ? srcKeys : [srcKeys]);
        if (weights && weights.length > 0) {
            return this._tmp_send(CmdZINTERSTORE, destKey, numkeys, ...keys, "WEIGHTS", ...weights)._wait(castNumber);
        }
        return this._tmp_send(CmdZINTERSTORE, destKey, numkeys, ...keys)._wait(castNumber);
    }
    pfAdd(key, ...elements) {
        var keys = Array.isArray(elements[0]) ? elements[0] : elements;
        keys = this._fix_prefix_any(keys);
        return this._tmp_send(CmdPfadd, ...keys)._wait(castNumber);
    }
    pfCount(key) {
        key = this._fix_prefix_any(key);
        return this._tmp_send(CmdPfcount, key)._wait(castNumber);
    }
    pfMerge(destKey, ...sourceKeys) {
        var keys = Array.isArray(sourceKeys[0]) ? sourceKeys[0] : sourceKeys;
        keys.unshift(destKey);
        keys = this._fix_prefix_any(sourceKeys);
        return this._tmp_send(CmdPfmerge, ...keys)._wait(castBool);
    }
    publish(channel, data) {
        return this._tmp_send(CmdPublish, channel, data)._wait();
    }
    pubsub(subCmd, ...args) {
        let fn = subCmd.toString().toLocaleLowerCase() != "numpat" ? castStrs : castNumber;
        return this._tmp_send(CmdPubsub, subCmd, ...args)._wait(fn);
    }
    pubsubChannels() {
        return this._tmp_send(CmdPubsub, "channels")._wait(castStrs);
    }
    pubsubNumSub(...channels) {
        let r = this._tmp_send(CmdPubsub, "numsub", ...channels)._wait(castStrs);
        let m = {};
        for (var i = 0; i < r.length; i += 2) {
            m[r[i]] = Number(r[i + 1]);
        }
        return m;
    }
    pubsubNumPat() {
        return this._tmp_send(CmdPubsub, "numpat")._wait(castNumber);
    }
    _real_sub(cmd, key, fn, isSubscribe) {
        this._pre_sub();
        var r = this._tmp_send(cmd, key)._wait();
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
        let n;
        if (Array.isArray(key)) {
            var arr = key;
            arr.forEach(e => {
                n = this._real_sub(CmdSubscribe, e, fn, true);
            });
        }
        else {
            n = this._real_sub(CmdSubscribe, key.toString(), fn, true);
        }
        return n;
    }
    psubscribe(key, fn) {
        // if(key==null||key.length<1||!util.isFunction(fn))return;
        key = this._fix_prefix_str(key);
        let n;
        if (Array.isArray(key)) {
            var arr = key;
            arr.forEach(e => {
                n = this._real_sub(CmdPSubscribe, e, fn, false);
            });
        }
        else {
            n = this._real_sub(CmdPSubscribe, key.toString(), fn, false);
        }
        return n;
    }
    _real_unsub(cmd, key, fn, fns) {
        if (!fns) {
            return 0;
        }
        var r = this._tmp_send(cmd, key)._wait();
        var idx = fns[key].indexOf(fn);
        if (idx > -1) {
            fns[key].splice(idx, 1);
        }
        if (r < 1) {
            delete fns[key];
        }
        this._after_unsub();
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
    _pre_sub() {
        // if(!this._connected){
        //     throw new RedisError("io_error");
        // }
        if (!this._sub_backs) {
            if (this._mult_backs) {
                throw new RedisError("in_mult_exec");
            }
            if (this._backs && this._backs.length > 0) {
                this._backs[this._backs.length - 1].wait();
            }
            this._sub_backs = [];
            this._subFn = {};
            this._psubFn = {};
        }
    }
    _after_unsub() {
        if (Object.keys(this._subFn).length < 1 && Object.keys(this._psubFn).length < 1) {
            if (this._sub_backs.length > 0) {
                this._sub_backs[this._sub_backs.length - 1].wait();
                this._after_unsub();
                return;
            }
            this._sub_backs = null;
            this._subFn = null;
            this._psubFn = null;
        }
    }
    _pre_sub_onConnect() {
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
        if (!Array.isArray(reply)) {
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
    xlen(key) {
        return this._tmp_send(CmdXLEN, key)._wait(castNumber);
    }
    xAdd(key, idOption, ...kvs) {
        if (Number.isInteger(idOption)) {
            return this._tmp_send(CmdXADD, key, idOption, ...kvs)._wait(castStr);
        }
        return this._tmp_send(CmdXADD, key, ...String(idOption).split(" "), ...kvs)._wait(castStr);
    }
    xDel(key, ...ids) {
        return this._tmp_send(CmdXDEL, ...ids)._wait(castNumber);
    }
    xRange(key, start, end, countLimit) {
        let t = countLimit ? this._tmp_send(CmdXRANGE, key, start, end, "COUNT", countLimit) :
            this._tmp_send(CmdXRANGE, key, start, end);
        return t._wait(deepCastStrs);
    }
    xRangeWrap(key, start, end, countLimit) {
        let r = this.xRange(key, start, end, countLimit);
        return this._xRangeRspWrap(r);
    }
    xRevRange(key, start, end, countLimit) {
        let t = countLimit ? this._tmp_send(CmdXREVRANGE, key, start, end, "COUNT", countLimit) :
            this._tmp_send(CmdXREVRANGE, key, start, end);
        return t._wait(deepCastStrs);
    }
    xRevRangeWrap(key, start, end, countLimit) {
        let r = this.xRevRange(key, start, end, countLimit);
        return this._xRangeRspWrap(r);
    }
    _xRangeRspWrap(r) {
        for (var i = 0; i < r.length; i++) {
            var id = r[i][0], vs = r[i][1], es = [];
            for (var j = 0; j < vs.length; j += 2) {
                es.push({ k: vs[j], v: vs[j + 1] });
            }
            r[i] = { id: id, items: es };
        }
        return r;
    }
    xTrimMaxlen(key, count, fast) {
        return (fast ? this._tmp_send(CmdXTRIM, key, "MAXLEN", '~', count) : this._tmp_send(CmdXTRIM, key, "MAXLEN", count))._wait(castNumber);
    }
    xInfoGroups(key) {
        return this._tmp_send(CmdXINFO, "GROUPS", key)._wait(castXInfo);
    }
    xInfoConsumers(key, group) {
        return this._tmp_send(CmdXINFO, "CONSUMERS", key, group)._wait(castXInfo);
    }
    xInfoStream(key) {
        return this._tmp_send(CmdXINFO, "STREAM", key)._wait(castXInfo);
    }
    xGroupCreate(key, group, id) {
        return this._tmp_send(CmdXGROUP, "CREATE", key, group, id)._wait(castBool);
    }
    xGroupDestroy(key, group) {
        return this._tmp_send(CmdXGROUP, "DESTROY", key, group)._wait(castBool);
    }
    xGroupDelconsumer(key, group, consumer) {
        return this._tmp_send(CmdXGROUP, "DELCONSUMER", key, group, consumer)._wait(castAuto);
    }
    xGroupSetid(key, group, id) {
        return this._tmp_send(CmdXGROUP, "SETID", key, group, id)._wait(castAuto);
    }
    xReadGroup(group, consumer, streamOptions, count) {
        let args = [CmdXREADGROUP, "GROUP", group, consumer];
        if (Number.isInteger(count)) {
            args.push("COUNT", count);
        }
        args.push("STREAMS");
        for (var k in streamOptions) {
            args.push(k, streamOptions[k]);
        }
        return this._tmp_send(...args)._wait(castAuto);
    }
    xRead(streamKeys, ids, count) {
        let args = [CmdXREAD];
        if (Number.isInteger(count)) {
            args.push("COUNT", count);
        }
        if (!ids) {
            ids = [].fill(0, 0, streamKeys.length);
        }
        args.push("STREAMS", ...streamKeys, ...ids);
        return this._tmp_send(...args)._wait(castAuto);
    }
    xAck(key, ...ids) {
        return this._tmp_send(CmdXACK, key, "group", ...ids)._wait(castNumber);
    }
    xPending(key, group, limit, consumer) {
        let args = [CmdXPENDING, key, group];
        if (limit) {
            args.push(limit.start, limit.end, limit.count);
        }
        if (consumer) {
            args.push(consumer);
        }
        return this._tmp_send(...args)._wait(castAuto);
    }
    xClaim(key, group, consumer, minIdelTimes, ids, options) {
        let args = [CmdXCLAIM, key, group, consumer, minIdelTimes, ...ids];
        if (options) {
            for (var k in options) {
                if (options[k]) {
                    args.push(k, options[k]);
                }
                else {
                    args.push(k);
                }
            }
        }
        return this._tmp_send(...args)._wait(castAuto);
    }
    _fix_prefix_str(k) {
        if (!this._prefix.buf) {
            return k;
        }
        if (Array.isArray(k)) {
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
        if (Array.isArray(k)) {
            var b = k;
            b.forEach((k, i, a) => {
                if (Buffer.isBuffer(k)) {
                    a[i] = Buffer.concat([this._prefix.buf, k]);
                }
                else {
                    a[i] = Buffer.from(this._prefix.str + k);
                }
            });
            return k;
        }
        if (Buffer.isBuffer(k)) {
            return Buffer.concat([this._prefix.buf, k]);
        }
        return Buffer.from(this._prefix.str + k);
    }
}
exports.Redis = Redis;
class OptEvent {
    constructor() {
        this.evt = new coroutine.Event(false);
    }
    wait(convert) {
        let e = new RedisError();
        this.evt.wait();
        if (this.err) {
            e.message = String(this.err);
            throw e;
        }
        return convert && this.data != null ? convert(this.data) : this.data;
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
        let e = new RedisError();
        this.evt.wait();
        if (this.errs.length > 0) {
            if (throwErr) {
                e.message = String(this.errs[0]);
                throw e;
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
class RedisPipeLine extends Redis {
    constructor(realRedis) {
        super(null);
        this._$_casts = [];
        this._$_real = realRedis;
        this._prefix = realRedis["_prefix"];
    }
    _before_send() {
    }
    _tmp_send(...args) {
        return super._tmp_send(...args);
    }
    _wait(convert) {
        this._$_casts.push(convert);
    }
    pipeSubmit() {
        if (this._temp_cmds.length < 1) {
            return [];
        }
        if (this._temp_cmds.length != this._$_casts.length) {
            throw "readis_some_fn_imp_check";
        }
        let r = this._$_real;
        this._$_real = null;
        return r["_pipeline_submit_bridge"](this._temp_cmds, this._$_casts);
    }
    _pre_trans() {
        throw "redis_in_pipeline";
    }
    _pre_sub() {
        throw "redis_in_pipeline";
    }
    _pre_block() {
        throw "redis_in_pipeline";
    }
}
class RedisError extends Error {
    get name() {
        return this.constructor.name;
    }
}
exports.RedisError = RedisError;
class RespReader {
    constructor(sock, handler) {
        this.sock = sock;
        this.handler = handler;
        this.EMPTY_BUFFER = Buffer.from("");
    }
    kill() {
        this.killed = true;
    }
    run() {
        coroutine.start(this.read.bind(this));
    }
    read() {
        let self = this, handler = self.handler, sock = self.sock, reader = new io.BufferedStream(sock), line;
        reader.EOL = '\r\n';
        while (!self.killed && handler.check(sock)) {
            try {
                line = reader.readLine();
                // console.log("line...",line)
                if (line == null) {
                    !self.killed && coroutine.start(handler.onClose);
                    break;
                }
                if (line[0] == '+') {
                    handler.replyData(line.substr(1));
                }
                else if (line[0] == ':') {
                    handler.replyData(Number(line.substr(1)));
                }
                else if (line[0] == '$') {
                    let raw = self.readBulkStr(reader, Number(line.substr(1)));
                    if (raw === 0) {
                        !self.killed && coroutine.start(handler.onClose);
                        break;
                    }
                    handler.replyData(raw);
                }
                else if (line[0] == '*') {
                    let multOpt = {};
                    let arr = self.readMult(reader, Number(line.substr(1)), multOpt);
                    if (multOpt.lost) {
                        !self.killed && coroutine.start(handler.onClose);
                        break;
                    }
                    if (multOpt.err) {
                        handler.replyError(multOpt.err);
                    }
                    handler.replyData(arr);
                }
                else if (line[0] == '-') {
                    handler.replyError(line.substr(1));
                }
                else {
                    console.error("RESP_unknow_protocol", line.length, line);
                }
            }
            catch (e) {
                if (!self.killed) {
                    coroutine.start(() => {
                        console.error("Redis|on_read", e);
                        handler.onErr(e);
                    });
                }
                break;
            }
        }
    }
    readMult(reader, len, opt) {
        if (len < 0) {
            return null;
        }
        let arr = new Array(len), subLine, subRaw, subLine0;
        for (var i = 0; i < len; i++) {
            subLine = reader.readLine();
            // console.log(len,i,subLine.length,subLine)
            if (subLine == null) {
                opt.lost = true;
                return opt;
            }
            subLine0 = subLine.charAt(0);
            if (subLine0 == '$') {
                subRaw = this.readBulkStr(reader, Number(subLine.substr(1)));
                // console.log("subRaw",subRaw)
                if (subRaw === 0) {
                    opt.lost = true;
                    return opt;
                }
                arr[i] = subRaw;
            }
            else if (subLine0 == ':') {
                arr[i] = Number(subLine.substr(1));
            }
            else if (subLine0 == '*') {
                let sub = this.readMult(reader, Number(subLine.substr(1)), opt);
                if (opt.lost) {
                    return opt;
                }
                arr[i] = sub;
            }
            else if (subLine0 == '+') {
                arr[i] = subLine.substr(1);
            }
            else if (subLine0 == '-') {
                arr[i] = subLine.substr(1);
                opt.err = arr[i];
            }
            else {
                console.warn("RESP_UNKNOW_SUB_OPT:" + subLine);
            }
        }
        return arr;
    }
    readBulkStr(reader, n) {
        if (n < 0) {
            return null;
        }
        let b = this.EMPTY_BUFFER;
        if (n > 0) {
            b = reader.read(n);
            // console.log("readBulkStr",n,b);
            if (b == null) {
                return 0;
            }
            while (b.length < n) {
                var t = reader.read(n - b.length);
                if (t == null) {
                    return null;
                }
                b = Buffer.concat([b, t]);
            }
        }
        if (reader.readLine() == null) {
            return 0;
        }
        return b;
    }
}
function uriToConfig(uri) {
    var urlObj = url.parse(uri);
    var host = urlObj.hostname;
    var port = parseInt(urlObj.port) > 0 ? parseInt(urlObj.port) : 6379;
    var auth = null;
    if (urlObj.auth.length > 0) {
        if (urlObj.username.length > 0 && urlObj.password.length > 0) {
            auth = urlObj.username + ':' + urlObj.password;
        }
        else {
            auth = decodeURIComponent(urlObj.auth);
        }
    }
    var timeout = 3000;
    var initDb = 0;
    var autoReconnect = true;
    var prefix = null;
    if (urlObj.query.length > 0) {
        var query = QueryString.parse(urlObj.query);
        if (query.db && parseInt(query.db) > 0 && parseInt(query.db) <= 16) {
            initDb = parseInt(query.db);
        }
        if (query.auth && query.auth.length > 0) {
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
            prefix = String(query.prefix).trim();
        }
    }
    return {
        db: initDb,
        timeout: timeout,
        autoReconnect: autoReconnect,
        auth: auth,
        host: host,
        port: port,
        prefix: prefix
    };
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
    return !!buf;
}
function castStr(buf) {
    return buf.toString();
}
function castBools(bufs) {
    if (Array.isArray(bufs)) {
        bufs.forEach((v, k, a) => {
            a[k] = !!v;
        });
    }
    else {
        bufs = [!!bufs];
    }
    return bufs;
}
function castStrs(bufs) {
    if (Array.isArray(bufs)) {
        bufs.forEach((v, k, a) => {
            a[k] = v ? v.toString() : v;
        });
    }
    else {
        bufs = [bufs == null ? null : bufs.toString()];
    }
    return bufs;
}
function deepCastStrs(r) {
    if (Array.isArray(r)) {
        r.forEach((v, k, a) => {
            if (Buffer.isBuffer(v)) {
                a[k] = v.toString();
            }
            else if (Array.isArray(v)) {
                a[k] = deepCastStrs(v);
            }
        });
    }
    else {
        r = [r == null ? null : String(r)];
    }
    return r;
}
function castXInfo(bufs) {
    var rsp = {};
    if (bufs.length) {
        if (Array.isArray(bufs[0])) {
            rsp = [];
            for (var i = 0; i < bufs.length; i++) {
                rsp.push(castXInfo(bufs[i]));
            }
        }
        else {
            for (var i = 0; i < bufs.length; i += 2) {
                var k = bufs[i].toString();
                if (Array.isArray(bufs[i + 1])) {
                    var es = bufs[i + 1];
                    var eid = es[0].toString();
                    var ek = es[1][0].toString();
                    var ev = es[1][1].toString();
                    rsp[k] = { id: eid, k: ek, v: ev };
                }
                else {
                    var v = bufs[i + 1].toString();
                    rsp[k] = Number(v);
                    if (Number.isNaN(rsp[k])) {
                        rsp[k] = v;
                    }
                }
            }
        }
    }
    return rsp;
}
function castNumber(buf) {
    if (!Number.isFinite(buf)) {
        buf = Number(buf.toString());
    }
    return buf;
}
function castNumbers(bufs) {
    if (Array.isArray(bufs)) {
        bufs.forEach((v, k, a) => {
            if (v != null) {
                a[k] = Number(v.toString());
            }
        });
    }
    else {
        bufs = [bufs == null ? null : Number(bufs.toString())];
    }
    return bufs;
}
function castBigInt(buf) {
    if (buf) {
        buf = global["BigInt"](buf.toString());
    }
    return buf;
}
function castBigInts(bufs) {
    if (Array.isArray(bufs)) {
        bufs.forEach((v, k, a) => {
            if (v != null) {
                a[k] = global["BigInt"](v.toString());
            }
        });
    }
    else {
        bufs = [bufs == null ? null : global["BigInt"](bufs.toString())];
    }
    return bufs;
}
function castAuto(a) {
    if (a == null)
        return a;
    if (Number.isFinite(a))
        return a;
    if (util.isBoolean(a))
        return a;
    if (Buffer.isBuffer(a)) {
        a = a.toString();
        if (a.length > 0) {
            var n = Number(a);
            if (!isNaN(n)) {
                if (Number.isInteger(n) && !Number.isSafeInteger(n)) {
                    return global["BigInt"](a);
                }
                return n;
            }
        }
        return a;
    }
    if (Array.isArray(a)) {
        a.forEach((iv, ik, ia) => {
            ia[ik] = castAuto(iv);
        });
    }
    return a;
}
function castJSON(bufs) {
    if (Array.isArray(bufs)) {
        bufs.forEach((v, k, a) => {
            a[k] = v ? JSON.parse(v.toString()) : v;
        });
    }
    else {
        bufs = bufs == null ? null : JSON.parse(bufs.toString());
    }
    return bufs;
}
function castDate(buf) {
    if (Buffer.isBuffer(buf)) {
        var s = buf.toString(), t = Date.parse(s);
        if (Number.isNaN(t)) {
            if (s.length > 8 && s.length < 15) {
                t = Number(s);
                if (!Number.isNaN(t)) { //unixtime timemillon, [1874->5138]
                    return new Date(s.length > 11 ? t : t * 1000);
                }
            }
        }
        else {
            return new Date(t);
        }
    }
    return null;
}
Redis["castAuto"] = castAuto;
Redis["castStr"] = castStr;
Redis["castStrs"] = castStrs;
Redis["castNumber"] = castNumber;
Redis["castNumbers"] = castNumbers;
Redis["castBigInt"] = castBigInt;
Redis["castBigInts"] = castBigInts;
Redis["castBool"] = castBool;
Redis["castBools"] = castBools;
Redis["castJSON"] = castJSON;
Redis["castDate"] = castDate;
const CODEC = 'utf8';
const CHAR_Star = Buffer.from('*', CODEC);
const CHAR_Dollar = Buffer.from('$', CODEC);
const BUF_EOL = Buffer.from('\r\n', CODEC);
function encodeBulk(code) {
    let buf = Buffer.isBuffer(code) ? code : Buffer.from(String(code), CODEC);
    return Buffer.concat([CHAR_Dollar, Buffer.from(String(buf.length), CODEC), BUF_EOL, buf, BUF_EOL]);
}
function encodeCommand(command) {
    let resps = command.map(encodeBulk);
    return Buffer.concat([
        CHAR_Star, Buffer.from(String(resps.length), CODEC), BUF_EOL, ...resps, BUF_EOL
    ]);
}
exports.encodeCommand = encodeCommand;
function encodeMultCommand(commands) {
    return Buffer.concat([...commands.map(encodeOneResp), BUF_EOL]);
}
exports.encodeMultCommand = encodeMultCommand;
function encodeOneResp(command) {
    let resps = command.map(encodeBulk);
    return Buffer.concat([
        CHAR_Star, Buffer.from(String(resps.length), CODEC), BUF_EOL, ...resps
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
const CmdPubsub = Buffer.from('pubsub');
const CmdSubscribe = Buffer.from('subscribe');
const CmdPSubscribe = Buffer.from('psubscribe');
const CmdUnSubscribe = Buffer.from('unsubscribe');
const CmdPUnSubscribe = Buffer.from('punsubscribe');
const CmdMessage = Buffer.from('message');
const CmdPMessage = Buffer.from('pmessage');
const CmdQuit = Buffer.from('quit');
const CmdPing = Buffer.from('ping');
const CmdEcho = Buffer.from('echo');
const CmdEval = Buffer.from('eval');
const CmdEvalSha = Buffer.from('evalsha');
const CmdScript = Buffer.from('script');
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
const CmdIncrByFloat = Buffer.from('incrbyfloat');
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
const CmdBrpopLpush = Buffer.from('brpoplpush');
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
const CmdZUNIONSTORE = Buffer.from("zunionstore");
const CmdZINTERSTORE = Buffer.from("zinterstore");
const CmdXADD = Buffer.from("XADD");
const CmdXDEL = Buffer.from("XDEL");
const CmdXTRIM = Buffer.from("XTRIM");
const CmdXLEN = Buffer.from("XLEN");
const CmdXRANGE = Buffer.from("XRANGE");
const CmdXREVRANGE = Buffer.from("XREVRANGE");
const CmdXACK = Buffer.from("XACK");
const CmdXCLAIM = Buffer.from("XCLAIM");
const CmdXGROUP = Buffer.from("XGROUP");
const CmdXINFO = Buffer.from("XINFO");
const CmdXPENDING = Buffer.from("XPENDING");
const CmdXREADGROUP = Buffer.from("XREADGROUP");
const CmdXREAD = Buffer.from("XREAD");
const CmdWatch = Buffer.from('watch');
const CmdUnWatch = Buffer.from('unwatch');
const CmdMulti = Buffer.from('multi');
const CmdExec = Buffer.from('exec');
const CmdDiscard = Buffer.from('discard');
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
