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

/// <reference path="_common.d.ts" />
/// <reference path="object.d.ts" />





/** module Or Internal Object */
/**
	* @brief 消息处理器接口
	* @detail 
	*/

declare class Class_Handler extends Class__object {
	
	
	
	/**
	 * 
	 * @brief 构造一个消息处理器链处理对象
	 * @param hdlrs 处理器数组
	 * 
	 * 
	 * 
	 */
	constructor(hdlrs: any[]);

	/**
	 * 
	 * @brief 创建一个消息处理器路由对象
	 * @param map 初始化路由参数
	 * 
	 * 
	 * 
	 */
	constructor(map: Fibjs.AnyObject);

	/**
	 * 
	 * @brief 创建一个 JavaSvript 消息处理器
	 * @param hdlr JavaScript 处理器函数
	 * 
	 * 
	 * 
	 */
	constructor(hdlr: Function);

	/**
	 * 
	 * @brief 构造一个 fileHandler 或者 HttpRepeater
	 * @param hdlr 处理器的地址参数
	 * 
	 * 
	 * 
	 */
	constructor(hdlr: string);

	/**
	 * 
	 * @brief 处理一个消息或对象
	 * @param v 指定处理的消息或对象
	 * @return 返回下一步的处理器
	 * 
	 * 
	 * @async
	 */
	invoke(v: Class__object, callback?: Fibjs.AsyncCallback<Class_Handler>/** = function (err: Error, result: Class_Handler) {}*/): Class_Handler;

} /** endof class */

/** endof `module Or Internal Object` */


