# fibjs_redis
fibjs redis

    ` npm -i fibjs_redis `

var r = new Redis();  
console.log(r.ping());  
r.set("frr","fredisO32哈!、", 1);  
console.log(r.get("frr"));
