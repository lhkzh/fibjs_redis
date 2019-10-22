var coroutine=require("coroutine");
var Redis=require("../lib/Redis");
var r = new Redis();
console.log(r.ping());
r.set("frr","fredisO32哈!、", 1);
console.log(r.get("frr"));
coroutine.sleep(1000);
console.log("frr_ttl?",r.get("frr"));

var p = r.pipeOpen();
p.set("foo","ofof",3);
p.set("faa","?",2);
p.mget(["foo","faa"]);
console.log("pipe_ret",p.pipeSubmit());

var m = r.multi();
m.set("fxx", "xxf",1);
m.set("fzz", "zzf",1);
m.get("foo");
m.pttl("faa");
m.publish("foo","foo!");
console.log("mult_ret", m.exec());

console.log(r.get("foo"));
r.set("bigint",BigInt(Math.pow(2,60)).toString(),120);
console.log(r.get("bigint"));
console.log(r.get("bigint", Redis.castBigInt))
console.log(r.get("bigint", Redis.castNumber))

var s=new Redis();
s.subscribe("foo",function(r){
   console.log("on_sub_foo",r);
});
r.publish("foo","wtf!");

coroutine.sleep(2000);

s.close();
r.close();
console.log("##########over")