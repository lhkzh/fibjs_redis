var coroutine=require("coroutine");
var Redis=require("../lib/Redis").Redis;
var r = new Redis();
console.log("ping",r.ping()=="PONG");
console.log("set",r.set("foo","data-foo",30)==true);
console.log('setNX', r.setNX('foo',"data-foo-nx",30)==false);
console.log("get",r.get("foo")=="data-foo");
console.log("strlen",r.strlen("foo")=="data-foo".length);
console.log("substr",r.substr("foo",0,3)=="data");
console.log("bitcount",r.bitCount("foo"));
console.log("bitPos",r.bitPos('foo',0,1));
console.log("bitGet",r.getBit('foo',0)==0);
console.log("getSet", r.getSet('foo','data-foo-getset'));
console.log('del',r.del('foo'));
console.log();
console.log('mset', r.mset({'f01':"m01",'f02':"m02",'f03':"m03"}));
console.log('mget',JSON.stringify(r.mgetWrap(['f01','f02','f03','f04']))=='{"f01":"m01","f02":"m02","f03":"m03","f04":null}');
console.log('ttl',r.ttl('f01')<0);
console.log('expire',r.expire('f01',1)==true);
console.log('pttl',r.pttl('f01')<=1000);
console.log('del',r.del('f01','f02','f03','f04')==3);
console.log();
r.del('flist');
console.log('lpush',r.lPush('flist',"a","b","c")==2);
console.log('lpushX_had',r.lPushx('flist','a')>0);
console.log('lpushX_nil',r.lPushx('flist_nil','a')==0);
console.log('lpop',r.lPop('flist')=='a');
console.log('lrange',JSON.stringify(r.lRange('flist',0,-1))=='["c","b","a"]');
console.log('llen',r.lLen('flist')==3);
r.del('flist');
console.log();
r.del('fmap');
console.log('hset',r.hSet('fmap','a','va')==true);
console.log('hsetnx',r.hSetNx('fmap','a','va')==false);
console.log('hsetnx',r.hSetNx('fmap','b','vb')==true);
console.log('hmset',r.hMset("fmap",{'c':"vc",'d':"vd"})==true);
console.log('hlen',r.hLen('fmap')==4);
console.log('hkeys',JSON.stringify(r.hKeys('fmap'))=='["a","b","c","d"]');
console.log('hvals',JSON.stringify(r.hVals('fmap'))=='["va","vb","vc","vd"]');
console.log('hmget', r.hMGet('fmap', ['a','c']).join(',')=='va,vc');
console.log('hincrby', r.hIncrBy('fmap', 'int',3)==3);
console.log('hincrby', r.hIncrBy('fmap', 'int',-2)==1);
console.log('hscan', JSON.stringify(r.hscan('fmap',0,'in*',1000))=='[0,{"int":"1"}');
r.del('hmap');
console.log();
r.del('fset');
console.log('sadd', r.sAdd('fset',"a","b","c",0,1,2,3,4,5)==8);
console.log('srem',r.sRem('fset',["a","b","c"])==3);
console.log("scard",r.sCard('fset')==6);
console.log("smembers",r.sMembers('fset').length==6);
console.log("sIsmember",r.sIsmember('fset',"a")==false);
console.log("sIsmember",r.sIsmember('fset',"1")==true);
console.log("spop",r.sPop('fset',1)!=null);
console.log("sscan",r.sscan("fset","0","*",100))
r.del('fset');
console.log();


var p = r.pipeOpen();
p.set("f01","data-01",2);
p.set("f02","data-02",2);
p.mget(["f01","f02"]);
p.del(['f01','f02'])
console.log("pipeline",p.pipeSubmit().length==4, p.exists('f01'));

var m = r.multi();
m.exists("f01");
m.set("f03", "mult-f03",30);
m.get("f01");
m.pttl("f03");
m.publish("foo","foo!");
console.log("mult/exec",m.exec().length==5);


var s=new Redis();
s.subscribe("foo",function(msg,channel){
   console.log("on_sub_msg["+channel+"]",msg.toString());
});
r.publish("foo","wtf!");
r.publish("foo","abc!");
coroutine.sleep(1);

s.close();
r.close();
console.log("##########over")