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
	* @brief x509 撤销证书对象
	* @detail X509Crl 对象属于 crypto 模块，创建：,```JavaScript,var k = new crypto.X509Crl();,```
	*/

declare class Class_X509Crl extends Class__object {
	
	
	
	/**
	 * 
	 * @brief X509Crl 构造函数
	 * 
	 * 
	 */
	constructor();

	/**
	 * 
	 * @brief X509Crl 构造函数,加载一个 DER 格式的撤销证书
	 * @param derCrl DER 格式的撤销证书
	 * 
	 * 
	 * 
	 */
	constructor(derCrl: Class_Buffer);

	/**
	 * 
	 * @brief X509Crl 构造函数,加载一个 PEM 格式的撤销证书
	 * @param pemCrl PEM 格式的撤销证书
	 * 
	 * 
	 * 
	 */
	constructor(pemCrl: string);

	/**
	 * 
	 * @brief 加载一个 DER 格式的撤销证书，可多次调用
	 * @param derCrl DER 格式的撤销证书
	 * 
	 * 
	 * 
	 */
	load(derCrl: Class_Buffer): void;

	/**
	 * 
	 * @brief 加载一个 PEM 格式的撤销证书，可多次调用
	 * @param pemCrl PEM 格式的撤销证书
	 * 
	 * 
	 * 
	 */
	load(pemCrl: string): void;

	/**
	 * 
	 * @brief 加载一个 PEM/DER 格式的撤销证书，可多次调用
	 * @param filename 撤销证书文件名
	 * 
	 * 
	 * 
	 */
	loadFile(filename: string): void;

	/**
	 * 
	 * @brief 导出已经加载的撤销证书
	 * @param pem 指定输出 PEM 格式的撤销证书，缺省为 true
	 * @return 以数组方式导出撤销证书链
	 * 
	 * 
	 * 
	 */
	dump(pem?: boolean/** = true*/): any[];

	/**
	 * 
	 * @brief 清空已经加载的撤销证书
	 * 
	 * 
	 * 
	 */
	clear(): void;

} /** endof class */

/** endof `module Or Internal Object` */


