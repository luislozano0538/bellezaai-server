import { createHash } from 'node:crypto';

// Limits apply to this server process. Shared storage is needed before scaling
// authentication across multiple instances. No proxy headers or raw emails stored.
export function createAuthGate({now=Date.now,maxEntries=5000,maxActive=4}={}) {
  const buckets=new Map();
  let active=0,globalStart=0,globalCount=0,lastCleanup=0;
  const windowMs=15*60*1000;
  function deny(res,seconds,message) {
    const retryAfter=Math.max(1,Math.ceil(seconds));
    res.set('Retry-After',String(retryAfter));
    res.status(429).json({error:message+' Vuelve a intentarlo en '+retryAfter+' segundos.',retryAfter});
    return null;
  }
  return {
    enter(operation,email,res) {
      const time=now();
      if(time-lastCleanup>=60000) {
        for(const [key,bucket] of buckets)if(bucket.until<=time)buckets.delete(key);
        lastCleanup=time;
      }
      const key=operation+':'+createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
      let bucket=buckets.get(key);
      if(bucket?.until<=time){buckets.delete(key);bucket=null;}
      const limit=['register','recovery'].includes(operation)?5:20;
      if(bucket&&bucket.count>=limit)return deny(res,(bucket.until-time)/1000,'Se alcanzó el límite de intentos para este correo.');
      if(active>=maxActive)return deny(res,5,'Hay demasiados accesos en curso.');
      if(time-globalStart>=60000){globalStart=time;globalCount=0;}
      if(globalCount>=120)return deny(res,(globalStart+60000-time)/1000,'El acceso está temporalmente ocupado.');
      if(!bucket&&buckets.size>=maxEntries)return deny(res,60,'El acceso está temporalmente ocupado.');
      if(!bucket){bucket={count:0,until:time+windowMs};buckets.set(key,bucket);}
      bucket.count++;globalCount++;active++;
      let released=false;
      return ()=>{if(!released){released=true;active--;}};
    }
  };
}
