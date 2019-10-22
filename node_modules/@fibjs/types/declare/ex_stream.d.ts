/***************************************************************************
 *                                                                         *
 *   This file was automatically generated with idlc.js                    *
 *	 build info: 								   						   *
 *   	- fibjs	: 0.28.0                                                   *
 *   	- date	: Sep  2 2019 18:12:43                                     *
 *                                                                         *
 ***************************************************************************/

/** 
 * @author Richard <richardo2016@gmail.com>
 *
 */



/// <reference path="_common.d.ts" />
/// <reference path="events.d.ts" />

declare module "stream" {
    import * as events from "events";

    class internal extends events.EventEmitter {
        pipe<T extends Fibjs.WritableStream>(destination: T, options?: { end?: boolean; }): T;
    }

    namespace internal {
        export class Stream extends internal { }

        export interface ReadableOptions {
            highWaterMark?: number;
            encoding?: string;
            objectMode?: boolean;
            read?(this: Readable, size: number): void;
            destroy?(this: Readable, error: Error | null, callback: (error: Error | null) => void): void;
        }

        export class Readable extends Stream implements Fibjs.ReadableStream {
            readable: boolean;
            readonly readableHighWaterMark: number;
            readonly readableLength: number;
            constructor(opts?: ReadableOptions);
            _read(size: number): void;
            read(size?: number): any;
            setEncoding(encoding: string): this;
            pause(): this;
            resume(): this;
            isPaused(): boolean;
            unpipe<T extends Fibjs.WritableStream>(destination?: T): this;
            unshift(chunk: any): void;
            wrap(oldStream: Fibjs.ReadableStream): this;
            push(chunk: any, encoding?: string): boolean;
            _destroy(error: Error | null, callback: (error: Error | null) => void): void;
            destroy(error?: Error): void;

            /**
             * Event emitter
             * The defined events on documents including:
             * 1. close
             * 2. data
             * 3. end
             * 4. readable
             * 5. error
             */
            addListener(event: "close", listener: () => void): object;
            addListener(event: "data", listener: (chunk: any) => void): object;
            addListener(event: "end", listener: () => void): object;
            addListener(event: "readable", listener: () => void): object;
            addListener(event: "error", listener: (err: Error) => void): object;
            addListener(event: string | symbol, listener: (...args: any[]) => void): object;
            addListener(map: object): object;

            emit(event: "close"): boolean;
            emit(event: "data", chunk: any): boolean;
            emit(event: "end"): boolean;
            emit(event: "readable"): boolean;
            emit(event: "error", err: Error): boolean;
            emit(event: string | symbol, ...args: any[]): boolean;

            on(event: "close", listener: () => void): this;
            on(event: "data", listener: (chunk: any) => void): this;
            on(event: "end", listener: () => void): this;
            on(event: "readable", listener: () => void): this;
            on(event: "error", listener: (err: Error) => void): this;
            on(event: string | symbol, listener: (...args: any[]) => void): this;
            on(map: object): object;

            once(event: "close", listener: () => void): this;
            once(event: "data", listener: (chunk: any) => void): this;
            once(event: "end", listener: () => void): this;
            once(event: "readable", listener: () => void): this;
            once(event: "error", listener: (err: Error) => void): this;
            once(event: string | symbol, listener: (...args: any[]) => void): this;
            once(map: object): object;

            prependListener(event: "close", listener: () => void): this;
            prependListener(event: "data", listener: (chunk: any) => void): this;
            prependListener(event: "end", listener: () => void): this;
            prependListener(event: "readable", listener: () => void): this;
            prependListener(event: "error", listener: (err: Error) => void): this;
            prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
            prependListener(map: object): object;

            prependOnceListener(event: "close", listener: () => void): this;
            prependOnceListener(event: "data", listener: (chunk: any) => void): this;
            prependOnceListener(event: "end", listener: () => void): this;
            prependOnceListener(event: "readable", listener: () => void): this;
            prependOnceListener(event: "error", listener: (err: Error) => void): this;
            prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
            prependOnceListener(map: object): object;

            removeListener(event: "close", listener: () => void): this;
            removeListener(event: "data", listener: (chunk: any) => void): this;
            removeListener(event: "end", listener: () => void): this;
            removeListener(event: "readable", listener: () => void): this;
            removeListener(event: "error", listener: (err: Error) => void): this;
            removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
            removeListener(evt: string): object;
            removeListener(map: object): object;

            [Symbol.asyncIterator](): AsyncIterableIterator<any>;
        }

        export interface WritableOptions {
            highWaterMark?: number;
            decodeStrings?: boolean;
            objectMode?: boolean;
            write?(this: Writable, chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
            writev?(this: Writable, chunks: Array<{ chunk: any, encoding: string }>, callback: (error?: Error | null) => void): void;
            destroy?(this: Writable, error: Error | null, callback: (error: Error | null) => void): void;
            final?(this: Writable, callback: (error?: Error | null) => void): void;
        }

        export class Writable extends Stream implements Fibjs.WritableStream {
            writable: boolean;
            readonly writableHighWaterMark: number;
            readonly writableLength: number;
            constructor(opts?: WritableOptions);
            _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
            _writev?(chunks: Array<{ chunk: any, encoding: string }>, callback: (error?: Error | null) => void): void;
            _destroy(error: Error | null, callback: (error: Error | null) => void): void;
            _final(callback: (error?: Error | null) => void): void;
            write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean;
            write(chunk: any, encoding?: string, cb?: (error: Error | null | undefined) => void): boolean;
            setDefaultEncoding(encoding: string): this;
            end(cb?: () => void): void;
            end(chunk: any, cb?: () => void): void;
            end(chunk: any, encoding?: string, cb?: () => void): void;
            cork(): void;
            uncork(): void;
            destroy(error?: Error): void;

            /**
             * Event emitter
             * The defined events on documents including:
             * 1. close
             * 2. drain
             * 3. error
             * 4. finish
             * 5. pipe
             * 6. unpipe
             */
            addListener(event: "close", listener: () => void): object;
            addListener(event: "drain", listener: () => void): object;
            addListener(event: "error", listener: (err: Error) => void): object;
            addListener(event: "finish", listener: () => void): object;
            addListener(event: "pipe", listener: (src: Readable) => void): object;
            addListener(event: "unpipe", listener: (src: Readable) => void): object;
            addListener(event: string | symbol, listener: (...args: any[]) => void): object;
            addListener(map: object): object;

            emit(event: "close"): boolean;
            emit(event: "drain"): boolean;
            emit(event: "error", err: Error): boolean;
            emit(event: "finish"): boolean;
            emit(event: "pipe", src: Readable): boolean;
            emit(event: "unpipe", src: Readable): boolean;
            emit(event: string | symbol, ...args: any[]): boolean;

            on(event: "close", listener: () => void): object;
            on(event: "drain", listener: () => void): object;
            on(event: "error", listener: (err: Error) => void): object;
            on(event: "finish", listener: () => void): object;
            on(event: "pipe", listener: (src: Readable) => void): object;
            on(event: "unpipe", listener: (src: Readable) => void): object;
            on(event: string | symbol, listener: (...args: any[]) => void): object;
            on(map: object): object;

            once(event: "close", listener: () => void): object;
            once(event: "drain", listener: () => void): object;
            once(event: "error", listener: (err: Error) => void): object;
            once(event: "finish", listener: () => void): object;
            once(event: "pipe", listener: (src: Readable) => void): object;
            once(event: "unpipe", listener: (src: Readable) => void): object;
            once(event: string | symbol, listener: (...args: any[]) => void): object;
            once(map: object): object;

            prependListener(event: "close", listener: () => void): object;
            prependListener(event: "drain", listener: () => void): object;
            prependListener(event: "error", listener: (err: Error) => void): object;
            prependListener(event: "finish", listener: () => void): object;
            prependListener(event: "pipe", listener: (src: Readable) => void): object;
            prependListener(event: "unpipe", listener: (src: Readable) => void): object;
            prependListener(event: string | symbol, listener: (...args: any[]) => void): object;
            prependListener(map: object): object;

            prependOnceListener(event: "close", listener: () => void): object;
            prependOnceListener(event: "drain", listener: () => void): object;
            prependOnceListener(event: "error", listener: (err: Error) => void): object;
            prependOnceListener(event: "finish", listener: () => void): object;
            prependOnceListener(event: "pipe", listener: (src: Readable) => void): object;
            prependOnceListener(event: "unpipe", listener: (src: Readable) => void): object;
            prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): object;
            prependOnceListener(map: object): object;

            removeListener(event: "close", listener: () => void): object;
            removeListener(event: "drain", listener: () => void): object;
            removeListener(event: "error", listener: (err: Error) => void): object;
            removeListener(event: "finish", listener: () => void): object;
            removeListener(event: "pipe", listener: (src: Readable) => void): object;
            removeListener(event: "unpipe", listener: (src: Readable) => void): object;
            removeListener(event: string | symbol, listener: (...args: any[]) => void): object;
            removeListener(evt: string): object;
            removeListener(map: object): object;
        }

        export interface DuplexOptions extends ReadableOptions, WritableOptions {
            allowHalfOpen?: boolean;
            readableObjectMode?: boolean;
            writableObjectMode?: boolean;
            read?(this: Duplex, size: number): void;
            write?(this: Duplex, chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
            writev?(this: Duplex, chunks: Array<{ chunk: any, encoding: string }>, callback: (error?: Error | null) => void): void;
            final?(this: Duplex, callback: (error?: Error | null) => void): void;
            destroy?(this: Duplex, error: Error | null, callback: (error: Error | null) => void): void;
        }

        // Note: Duplex extends both Readable and Writable.
        export class Duplex extends Readable implements Writable {
            writable: boolean;
            readonly writableHighWaterMark: number;
            readonly writableLength: number;
            constructor(opts?: DuplexOptions);
            _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
            _writev?(chunks: Array<{ chunk: any, encoding: string }>, callback: (error?: Error | null) => void): void;
            _destroy(error: Error | null, callback: (error: Error | null) => void): void;
            _final(callback: (error?: Error | null) => void): void;
            write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean;
            write(chunk: any, encoding?: string, cb?: (error: Error | null | undefined) => void): boolean;
            setDefaultEncoding(encoding: string): this;
            end(cb?: () => void): void;
            end(chunk: any, cb?: () => void): void;
            end(chunk: any, encoding?: string, cb?: () => void): void;
            cork(): void;
            uncork(): void;
        }

        type TransformCallback = (error?: Error, data?: any) => void;

        export interface TransformOptions extends DuplexOptions {
            read?(this: Transform, size: number): void;
            write?(this: Transform, chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
            writev?(this: Transform, chunks: Array<{ chunk: any, encoding: string }>, callback: (error?: Error | null) => void): void;
            final?(this: Transform, callback: (error?: Error | null) => void): void;
            destroy?(this: Transform, error: Error | null, callback: (error: Error | null) => void): void;
            transform?(this: Transform, chunk: any, encoding: string, callback: TransformCallback): void;
            flush?(this: Transform, callback: TransformCallback): void;
        }

        export class Transform extends Duplex {
            constructor(opts?: TransformOptions);
            _transform(chunk: any, encoding: string, callback: TransformCallback): void;
            _flush(callback: TransformCallback): void;
        }

        export class PassThrough extends Transform { }

        export function pipeline<T extends Fibjs.WritableStream>(stream1: Fibjs.ReadableStream, stream2: T, callback?: (err: Fibjs.ErrnoException) => void): T;
        export function pipeline<T extends Fibjs.WritableStream>(stream1: Fibjs.ReadableStream, stream2: Fibjs.ReadWriteStream, stream3: T, callback?: (err: Fibjs.ErrnoException) => void): T;
        export function pipeline<T extends Fibjs.WritableStream>(stream1: Fibjs.ReadableStream, stream2: Fibjs.ReadWriteStream, stream3: Fibjs.ReadWriteStream, stream4: T, callback?: (err: Fibjs.ErrnoException) => void): T;
        export function pipeline<T extends Fibjs.WritableStream>(stream1: Fibjs.ReadableStream, stream2: Fibjs.ReadWriteStream, stream3: Fibjs.ReadWriteStream, stream4: Fibjs.ReadWriteStream, stream5: T, callback?: (err: Fibjs.ErrnoException) => void): T;
        export function pipeline(streams: Array<Fibjs.ReadableStream | Fibjs.WritableStream | Fibjs.ReadWriteStream>, callback?: (err: Fibjs.ErrnoException) => void): Fibjs.WritableStream;
        export function pipeline(stream1: Fibjs.ReadableStream, stream2: Fibjs.ReadWriteStream | Fibjs.WritableStream, ...streams: Array<Fibjs.ReadWriteStream | Fibjs.WritableStream | ((err: Fibjs.ErrnoException) => void)>): Fibjs.WritableStream;
        export namespace pipeline {
            export function __promisify__<T extends Fibjs.WritableStream>(stream1: Fibjs.ReadableStream, stream2: T): Promise<void>;
            export function __promisify__<T extends Fibjs.WritableStream>(stream1: Fibjs.ReadableStream, stream2: Fibjs.ReadWriteStream, stream3: T): Promise<void>;
            export function __promisify__<T extends Fibjs.WritableStream>(stream1: Fibjs.ReadableStream, stream2: Fibjs.ReadWriteStream, stream3: Fibjs.ReadWriteStream, stream4: T): Promise<void>;
            export function __promisify__<T extends Fibjs.WritableStream>(stream1: Fibjs.ReadableStream, stream2: Fibjs.ReadWriteStream, stream3: Fibjs.ReadWriteStream, stream4: Fibjs.ReadWriteStream, stream5: T): Promise<void>;
            export function __promisify__(streams: Array<Fibjs.ReadableStream | Fibjs.WritableStream | Fibjs.ReadWriteStream>): Promise<void>;
            export function __promisify__(stream1: Fibjs.ReadableStream, stream2: Fibjs.ReadWriteStream | Fibjs.WritableStream, ...streams: Array<Fibjs.ReadWriteStream | Fibjs.WritableStream>): Promise<void>;
        }
    }

    export = internal;
}

