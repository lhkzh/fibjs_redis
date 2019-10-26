# fibjs_redis
fibjs redis

 使用fibjs实现的Redis客户端。  
支持 pipeline、mult/exec、pub/sub、以及redis4.0的api。  
使用注意：以下情况禁止使用公共的Redis对象  
 1. block系列api（blpop...）会阻塞  
 2. mult/exec 这个api开启后其他Fiber调用命令也会乱入  
 3. sub系列  开启(p)subscribe后禁用大多数api方法了  

 ` npm -i fibjs_redis `

const Redis=require("fibjs_redis");  
var r = new Redis();  
console.log(r.ping());  
r.set("hi","hello fibjs!", 1);  
console.log(r.get("hi"));

r.set("anum",323);  
console.log(typeof r.get("anum"));//string  
console.log(typeof r.get("anum", Redis.castNumber));//number  
console.log(typeof r.get("anum", Redis.castBigInt));//BigInt  
console.log(typeof r.incr("anum"));//number  
console.log(typeof r.incr("anum", Redis.castBigInt));//BigInt  


