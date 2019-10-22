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
/// <reference path="object.d.ts" />





/** module Or Internal Object */
/**
	* @brief 事件信息对象，用于在事件中传递信息
	* @detail 
	*/

declare class Class_EventInfo extends Class__object {
	
	/**
	 * class prop 
	 *
	 * 
	 * 查询事件错误编码
	 * 
	 * @readonly
	 * @type Integer
	 */
	
	code: number
	
	/**
	 * class prop 
	 *
	 * 
	 * 查询事件错误信息
	 * 
	 * @readonly
	 * @type String
	 */
	
	reason: string
	
	/**
	 * class prop 
	 *
	 * 
	 * 查询事件类型
	 * 
	 * @readonly
	 * @type String
	 */
	
	type: string
	
	/**
	 * class prop 
	 *
	 * 
	 * 查询触发事件的对象
	 * 
	 * @readonly
	 * @type Object
	 */
	
	target: Fibjs.AnyObject
	
	
	
} /** endof class */

/** endof `module Or Internal Object` */


