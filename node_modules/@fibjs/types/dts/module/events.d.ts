/// <reference path="../_import/_fibjs.d.ts" />
/// <reference path="../interface/EventEmitter.d.ts" />
/**
 * @description 内置的 events 模块 
 * 
 */
declare module 'events' {
    /**
     * @description 创建一个 EventEmitter 对象，参见 EventEmitter 
     */
    const EventEmitter: typeof Class_EventEmitter;

}

