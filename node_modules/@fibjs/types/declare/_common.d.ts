/***************************************************************************
 *                                                                         *
 *   This file was automatically generated with idlc.js                    *
 *	 build info: 								   						   *
 *   	- fibjs	: 0.30.0-dev                                               *
 *   	- date	: Nov 22 2019 22:42:15                                     *
 *                                                                         *
 ***************************************************************************/

/** 
 * @author Richard <richardo2016@gmail.com>
 *
 */



/// <reference path="EventEmitter.d.ts" />
/// <reference path="Buffer.d.ts" />

declare namespace Fibjs {
	interface ErrnoException extends Error {
        errno?: number;
        code?: string;
        path?: string;
        syscall?: string;
        stack?: string;
    }

	interface AsyncCallback<T_RESP=any> {
		<T = T_RESP, T_CALLBACK_RESP = any, T_THIS = any>(this: T_THIS, err: Error, result?: T): T_CALLBACK_RESP | void
	}

    interface AnyObject {
        [k: string]: any
    }

    export interface ReadableStream extends Class_EventEmitter {
        readable: boolean;
        read(size?: number): string | Class_Buffer;
        setEncoding(encoding: string): this;
        pause(): this;
        resume(): this;
        isPaused(): boolean;
        pipe<T extends WritableStream>(destination: T, options?: { end?: boolean; }): T;
        unpipe<T extends WritableStream>(destination?: T): this;
        unshift(chunk: string): void;
        unshift(chunk: Class_Buffer): void;
        wrap(oldStream: ReadableStream): this;
        [Symbol.asyncIterator](): AsyncIterableIterator<string | Class_Buffer>;
    }

    export interface WritableStream extends Class_EventEmitter {
        writable: boolean;
        write(buffer: Class_Buffer | string, cb?: Function): boolean;
        write(str: string, encoding?: string, cb?: Function): boolean;
        end(cb?: Function): void;
        end(buffer: Class_Buffer, cb?: Function): void;
        end(str: string, cb?: Function): void;
        end(str: string, encoding?: string, cb?: Function): void;
    }

    export interface ReadWriteStream extends ReadableStream, WritableStream { }
}

