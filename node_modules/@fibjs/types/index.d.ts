/// <reference no-default-lib="true" />

/// <reference lib="es5"/>
/// <reference lib="es6"/>
/// <reference lib="es7"/>
/// <reference lib="es2015"/>
/// <reference lib="es2016"/>
/// <reference lib="es2017"/>
/// <reference lib="es2018"/>
/// <reference lib="es2019"/>

/// <reference path="./dts/_import/bridge.d.ts" />

import _Global = require('global');

declare module 'process' {
    const on: Class_EventEmitter['on']
    const addListener: Class_EventEmitter['addListener']
    const prependListener: Class_EventEmitter['prependListener']
    const once: Class_EventEmitter['once']
    const prependOnceListener: Class_EventEmitter['prependOnceListener']
    const off: Class_EventEmitter['off']
    const removeListener: Class_EventEmitter['removeListener']
    const setMaxListeners: Class_EventEmitter['setMaxListeners']
    const getMaxListeners: Class_EventEmitter['getMaxListeners']
    const listeners: Class_EventEmitter['listeners']
    const listenerCount: Class_EventEmitter['listenerCount']
    const eventNames: Class_EventEmitter['eventNames']
    const emit: Class_EventEmitter['emit']
}

declare global {
    var exports: {
        [k: string]: any
    };
    var module: {
        exports: typeof exports;
    };
    
    const Buffer: typeof _Global.Buffer
    const console: typeof _Global.console
    const process: typeof _Global.process
    const Master: typeof _Global.Master
    const global: typeof _Global.global
    const run: typeof _Global.run
    const require: typeof _Global.require & {
        main: any
    }
    const argv: typeof _Global.argv
    const __filename: typeof _Global.__filename
    const __dirname: typeof _Global.__dirname
    const setTimeout: typeof _Global.setTimeout
    const clearTimeout: typeof _Global.clearTimeout
    const setInterval: typeof _Global.setInterval
    const clearInterval: typeof _Global.clearInterval
    const setHrInterval: typeof _Global.setHrInterval
    const clearHrInterval: typeof _Global.clearHrInterval
    const setImmediate: typeof _Global.setImmediate
    const clearImmediate: typeof _Global.clearImmediate
    const GC: typeof _Global.GC
    const WebAssembly: any
} /** end of `declare global` */

declare module '@fibjs/types' {
}