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
	* @brief http 请求转发处理器
	* @detail http 用于将 http 请求转发到后端服务器,用法如下：,,```JavaScript,var http = require('http');,var hr = new http.Repeater('http://10.0.0.100:8080/test');,```
	*/
/// <reference path="Handler.d.ts" />
declare class Class_HttpRepeater extends Class_Handler {
	
	/**
	 * class prop 
	 *
	 * 
	 * @brief 查询当前后端服务器 url 列表
	 * 
	 * @readonly
	 * @type NArray
	 */
	
	urls: any[]
	
	/**
	 * class prop 
	 *
	 * 
	 * @brief 请求转发处理器内部使用的 HttpClient 对象
	 * 
	 * @readonly
	 * @type HttpClient
	 */
	
	client: Class_HttpClient
	
	
	
	/**
	 * 
	 * @brief HttpRepeater 构造函数，创建一个新的 HttpRepeater 对象
	 * @param url 指定一个后端服务器 url
	 * 
	 * 
	 * 
	 */
	constructor(url: string);

	/**
	 * 
	 * @brief HttpRepeater 构造函数，创建一个新的 HttpRepeater 对象
	 * @param urls 指定一组后端服务器 url
	 * 
	 * 
	 * 
	 */
	constructor(urls: any[]);

	/**
	 * 
	 * @brief 加载一组新的后端 url
	 * @param urls 指定一组后端服务器 url
	 * 
	 * 
	 * 
	 */
	load(urls: any[]): void;

} /** endof class */

/** endof `module Or Internal Object` */


