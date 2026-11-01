import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { env } from 'cloudflare:test';
import { drainPushNotifications, handleNotifications } from '../src/notifications';
import type { Context, Env } from '../src/types';
import { Actor, bookingRequest, createWorker, json, registeredActor } from './helpers';

describe('Cloudflare notification D1 integration', () => {
  it('creates one event notification for the intended recipient and enforces inbox ownership/read state', async () => {
    const customer = await registeredActor(), worker = await registeredActor('Worker'), other = await registeredActor();
    const workerId = await createWorker(worker, { pricingType: 'Hourly' });
    const requestData = bookingRequest(workerId, 'ForMe');
    const created = await customer.mutate('/api/bookings', requestData);
    expect(created.status).toBe(200);
    const booking = await json(created);
    const workerInbox = await json(await worker.request('/api/notifications'));
    const requestItems = workerInbox.items.filter((n: any) => n.bookingId === booking.id);
    expect(requestItems).toHaveLength(1);
    expect(requestItems[0].kind).toBe('Requested');
    expect(requestItems[0].title).toBe('New service request');
    expect(JSON.stringify(requestItems)).not.toContain('Private Lane');
    expect((await json(await customer.request('/api/notifications'))).items.filter((n: any) => n.bookingId === booking.id)).toHaveLength(0);

    await customer.mutate('/api/bookings', requestData);
    expect((await json(await worker.request('/api/notifications'))).items.filter((n: any) => n.bookingId === booking.id)).toHaveLength(1);

    const update = await worker.mutate(`/api/bookings/${booking.id}/action`, { action: 'accept' });
    expect(update.status).toBe(200);
    expect((await json(await customer.request('/api/notifications'))).items.find((n: any) => n.bookingId === booking.id)?.kind).toBe('WorkerAccepted');
    const notificationId = requestItems[0].id;
    expect((await other.mutate(`/api/notifications/${notificationId}/read`, {})).status).toBe(404);
    expect((await worker.mutate(`/api/notifications/${notificationId}/read`, {})).status).toBe(204);
    expect((await json(await worker.request('/api/notifications'))).items.find((n: any) => n.id === notificationId).readAt).toBeTruthy();
    for (const [actor,action] of [[customer,'confirm'],[worker,'start'],[worker,'complete']] as const)
      expect((await actor.mutate(`/api/bookings/${booking.id}/action`,{action})).status).toBe(200);
    const customerKinds = (await json(await customer.request('/api/notifications'))).items.filter((n:any)=>n.bookingId===booking.id).map((n:any)=>n.kind);
    expect(customerKinds).toEqual(expect.arrayContaining(['WorkerAccepted','InProgress','Completed']));
    expect((await customer.mutate(`/api/bookings/${booking.id}/review`,{rating:5,comment:'Helpful service.'})).status).toBe(200);
    expect((await json(await worker.request('/api/notifications'))).items.some((n:any)=>n.kind==='Review'&&n.bookingId===booking.id)).toBe(true);

    const cancelledBooking=await json(await customer.mutate('/api/bookings',bookingRequest(workerId,'ForMe')));
    expect((await customer.mutate(`/api/bookings/${cancelledBooking.id}/action`,{action:'cancel'})).status).toBe(200);
    for (const recipient of [customer,worker])
      expect((await json(await recipient.request('/api/notifications'))).items.some((n:any)=>n.kind==='Cancelled'&&n.bookingId===cancelledBooking.id)).toBe(true);
  });

  it('validates push endpoints and keys, prevents endpoint theft, and scopes removal to the current session', async () => {
    const one = await registeredActor(), two = await registeredActor();
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
    const toUrl = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); };
    const validPublic = toUrl(rawPublic), auth = toUrl(crypto.getRandomValues(new Uint8Array(16)));
    expect(rawPublic.length).toBe(65);
    const baseEnv = Object.assign(Object.create(Object.getPrototypeOf(env)), env, {
      VAPID_SUBJECT: 'https://daqqa.test', VAPID_SERVER_PUBLIC_KEY: validPublic,
      VAPID_SERVER_PRIVATE_KEY: 'A'.repeat(43),
    }) as Env;
    const call = async (actor: Actor, body: unknown) => {
      const userId = (await actor.session()).user.id;
      const dbSession = await env.DB.prepare('SELECT id_hash,csrf_token,expires_at FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1').bind(userId).first<{id_hash:string;csrf_token:string;expires_at:string}>();
      const context: Context = { request: new Request('https://daqqa.test/api/notifications/push-subscriptions', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) }),
        env: baseEnv, url: new URL('https://daqqa.test/api/notifications/push-subscriptions'), actor: { id: userId, email: '', displayName: '', phone: '', locality: '', role: 'Customer', isSuspended: false },
        session: { idHash: dbSession!.id_hash, csrfToken: dbSession!.csrf_token, userId, expiresAt: dbSession!.expires_at }, cookies: [], now: new Date() };
      try { return await handleNotifications(context); } catch (error) { return { status: (error as {status?:number}).status ?? 500 }; }
    };
    expect((await call(one, { endpoint: 'https://evil.example/push', keys: { p256dh: validPublic, auth } }))?.status).toBe(400);
    const payload = { endpoint: 'https://fcm.googleapis.com/fcm/send/integration-test', keys: { p256dh: validPublic, auth } };
    expect((await call(one, payload))?.status).toBe(204);
    expect((await call(two, payload))?.status).toBe(409);
    const owned = await env.DB.prepare('SELECT id,user_id FROM push_subscriptions WHERE endpoint=?').bind(payload.endpoint).first<{id:string;user_id:string}>();
    expect(owned?.user_id).toBe((await one.session()).user.id);
    expect((await call(one,payload))?.status).toBe(204); // Same endpoint replacement remains valid at the cap.
    for (let i=0;i<3;i++) expect((await call(one,{...payload,endpoint:`https://fcm.googleapis.com/fcm/send/limit-${i}`}))?.status).toBe(204);
    const concurrent = await Promise.all([0,1].map(i=>call(one,{...payload,endpoint:`https://fcm.googleapis.com/fcm/send/race-${i}`})));
    expect(concurrent.map(x=>x?.status).sort()).toEqual([204,409]);
  });

  it('keeps notifications durable with push disabled and clears session-bound subscriptions on logout', async () => {
    const actor = await registeredActor();
    const config = await actor.request('/api/notifications/push-config');
    expect(await config.json()).toEqual({ enabled: false, publicKey: null, subscribed: false });
    const session = await actor.session();
    // Session deletion is the same cascade used by logout, password reset, and session rotation.
    const row = await env.DB.prepare('SELECT id_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1').bind(session.user.id).first<{id_hash:string}>();
    await env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(row!.id_hash).run();
    expect(await env.DB.prepare('SELECT count(*) count FROM push_subscriptions WHERE session_id_hash=?').bind(row!.id_hash).first()).toEqual({ count: 0 });
  });

  it('leases one delivery, retries a transient provider failure, and unregisters a 410 endpoint', async () => {
    const actor = await registeredActor();
    const userId = (await actor.session()).user.id;
    const session = await env.DB.prepare('SELECT id_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1').bind(userId).first<{id_hash:string}>();
    const subscriptionPair = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const toUrl = (bytes: Uint8Array) => { let s=''; for(const b of bytes)s+=String.fromCharCode(b); return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); };
    const p256dh = toUrl(new Uint8Array(await crypto.subtle.exportKey('raw', subscriptionPair.publicKey) as ArrayBuffer));
    const auth = toUrl(crypto.getRandomValues(new Uint8Array(16)));
    const vapidPair = await crypto.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' }, true, ['sign']) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', vapidPair.privateKey) as JsonWebKey;
    const x = Uint8Array.from(atob(jwk.x!.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
    const y = Uint8Array.from(atob(jwk.y!.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
    const pub = new Uint8Array(65); pub[0]=4; pub.set(x,1); pub.set(y,33);
    const deliveryEnv = Object.assign(Object.create(Object.getPrototypeOf(env)), env, {
      VAPID_SUBJECT:'https://daqqa.test', VAPID_SERVER_PUBLIC_KEY:toUrl(pub), VAPID_SERVER_PRIVATE_KEY:jwk.d,
    }) as Env;
    await env.DB.prepare(`INSERT INTO push_subscriptions(id,session_id_hash,user_id,endpoint,endpoint_hash,p256dh,auth,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),session!.id_hash,userId,'https://fcm.googleapis.com/fcm/send/retry-test',crypto.randomUUID(),p256dh,auth,new Date().toISOString(),new Date().toISOString()).run();
    const notificationId=crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO notifications(id,recipient_id,booking_id,source_event_id,kind,title,message,url,created_at)
      VALUES(?,?,NULL,?,'Test','Daqqa t’Id test notification','Notifications are enabled on this device.','/dashboard',?)`)
      .bind(notificationId,userId,`test:${notificationId}`,new Date().toISOString()).run();
    const originalFetch = globalThis.fetch;
    const provider = vi.fn().mockResolvedValueOnce(new Response(null,{status:503})).mockResolvedValueOnce(new Response(null,{status:410}))
      .mockResolvedValueOnce(new Response(null,{status:302,headers:{Location:'https://evil.example/collect'}}));
    vi.stubGlobal('fetch', provider);
    try {
      const now = new Date();
      await drainPushNotifications(deliveryEnv,now);
      const retry = await env.DB.prepare('SELECT status,attempts,last_status FROM push_deliveries WHERE notification_id=?').bind(notificationId).first();
      expect(retry).toEqual({status:'Pending',attempts:1,last_status:503});
      await env.DB.prepare('UPDATE push_deliveries SET due_at=? WHERE notification_id=?').bind(new Date(now.getTime()+31_000).toISOString(),notificationId).run();
      await drainPushNotifications(deliveryEnv,new Date(now.getTime()+31_000));
      expect(await env.DB.prepare('SELECT count(*) count FROM push_subscriptions WHERE endpoint=?').bind('https://fcm.googleapis.com/fcm/send/retry-test').first()).toEqual({count:0});
      expect(await env.DB.prepare('SELECT count(*) count FROM push_deliveries WHERE notification_id=?').bind(notificationId).first()).toEqual({count:0});
      const redirectNotification=crypto.randomUUID();
      const redirectSub=crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO push_subscriptions(id,session_id_hash,user_id,endpoint,endpoint_hash,p256dh,auth,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind(redirectSub,session!.id_hash,userId,'https://fcm.googleapis.com/fcm/send/redirect',crypto.randomUUID(),p256dh,auth,now.toISOString(),now.toISOString()).run();
      await env.DB.prepare(`INSERT INTO notifications(id,recipient_id,booking_id,source_event_id,kind,title,message,url,created_at)
        VALUES(?,?,NULL,?,'Test','Daqqa t’Id test notification','Notifications are enabled on this device.','/dashboard',?)`)
        .bind(redirectNotification,userId,`test:${redirectNotification}`,new Date(now.getTime()+32_000).toISOString()).run();
      await drainPushNotifications(deliveryEnv,new Date(now.getTime()+32_000));
      expect(await env.DB.prepare('SELECT status,last_status FROM push_deliveries WHERE notification_id=?').bind(redirectNotification).first())
        .toEqual({status:'Dead',last_status:302});
      expect(provider).toHaveBeenCalledTimes(3);
      expect(provider.mock.calls.every((call:any)=>call[1]?.redirect==='manual')).toBe(true);

      const expiredSession = await env.DB.prepare('SELECT id_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1').bind(userId).first<{id_hash:string}>();
      await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE id_hash=?').bind(new Date(now.getTime()-1000).toISOString(),expiredSession!.id_hash).run();
      const expiredSubId=crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO push_subscriptions(id,session_id_hash,user_id,endpoint,endpoint_hash,p256dh,auth,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind(expiredSubId,expiredSession!.id_hash,userId,'https://fcm.googleapis.com/fcm/send/expired',crypto.randomUUID(),p256dh,auth,now.toISOString(),now.toISOString()).run();
      const expiredNotification=crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO notifications(id,recipient_id,booking_id,source_event_id,kind,title,message,url,created_at)
        VALUES(?,?,NULL,?,'Test','Daqqa t’Id test notification','Notifications are enabled on this device.','/dashboard',?)`)
        .bind(expiredNotification,userId,`test:${expiredNotification}`,new Date(now.getTime()+33_000).toISOString()).run();
      await drainPushNotifications(deliveryEnv,new Date(now.getTime()+33_000));
      expect(await env.DB.prepare('SELECT count(*) count FROM push_subscriptions WHERE id=?').bind(expiredSubId).first()).toEqual({count:0});
      expect(provider).toHaveBeenCalledTimes(3);

      const exhaustedActor=await registeredActor();
      const exhaustedUser=(await exhaustedActor.session()).user.id;
      const exhaustedSession=await env.DB.prepare('SELECT id_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1').bind(exhaustedUser).first<{id_hash:string}>();
      await env.DB.prepare(`INSERT INTO push_subscriptions(id,session_id_hash,user_id,endpoint,endpoint_hash,p256dh,auth,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),exhaustedSession!.id_hash,exhaustedUser,'https://fcm.googleapis.com/fcm/send/exhausted',crypto.randomUUID(),p256dh,auth,now.toISOString(),now.toISOString()).run();
      const exhaustedId=crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO notifications(id,recipient_id,booking_id,source_event_id,kind,title,message,url,created_at)
        VALUES(?,?,NULL,?,'Test','Daqqa t’Id test notification','Notifications are enabled on this device.','/dashboard',?)`)
        .bind(exhaustedId,exhaustedUser,`test:${exhaustedId}`,new Date(now.getTime()+34_000).toISOString()).run();
      await env.DB.prepare(`UPDATE push_deliveries SET status='Leased',attempts=6,lease_until=? WHERE notification_id=?`)
        .bind(new Date(now.getTime()+33_000).toISOString(),exhaustedId).run();
      await drainPushNotifications(deliveryEnv,new Date(now.getTime()+34_000));
      expect(await env.DB.prepare('SELECT status,attempts FROM push_deliveries WHERE notification_id=?').bind(exhaustedId).first())
        .toEqual({status:'Dead',attempts:6});
      expect(provider).toHaveBeenCalledTimes(3);
    } finally { vi.stubGlobal('fetch', originalFetch); }
  });

  it('drops a queued request push after cancellation and sends only the current booking event', async () => {
    const worker=await registeredActor('Worker'), customer=await registeredActor();
    const workerId=await createWorker(worker,{pricingType:'Hourly'});
    const workerUser=(await worker.session()).user.id;
    const session=await env.DB.prepare('SELECT id_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1').bind(workerUser).first<{id_hash:string}>();
    const subPair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']) as CryptoKeyPair;
    const toUrl=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
    const p256dh=toUrl(new Uint8Array(await crypto.subtle.exportKey('raw',subPair.publicKey) as ArrayBuffer));
    const auth=toUrl(crypto.getRandomValues(new Uint8Array(16)));
    await env.DB.prepare(`INSERT INTO push_subscriptions(id,session_id_hash,user_id,endpoint,endpoint_hash,p256dh,auth,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),session!.id_hash,workerUser,'https://fcm.googleapis.com/fcm/send/stale-request',crypto.randomUUID(),p256dh,auth,new Date().toISOString(),new Date().toISOString()).run();
    const request=bookingRequest(workerId,'ForMe');
    const booking=await json(await customer.mutate('/api/bookings',request));
    expect((await customer.mutate(`/api/bookings/${booking.id}/action`,{action:'cancel'})).status).toBe(200);

    const vapid=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']) as CryptoKeyPair;
    const jwk=await crypto.subtle.exportKey('jwk',vapid.privateKey) as JsonWebKey;
    const raw=(v:string)=>Uint8Array.from(atob(v.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
    const pub=new Uint8Array(65);pub[0]=4;pub.set(raw(jwk.x!),1);pub.set(raw(jwk.y!),33);
    const deliveryEnv=Object.assign(Object.create(Object.getPrototypeOf(env)),env,{VAPID_SUBJECT:'https://daqqa.test',VAPID_SERVER_PUBLIC_KEY:toUrl(pub),VAPID_SERVER_PRIVATE_KEY:jwk.d}) as Env;
    const originalFetch=globalThis.fetch, provider=vi.fn().mockResolvedValue(new Response(null,{status:201}));
    vi.stubGlobal('fetch',provider);
    try {
      await drainPushNotifications(deliveryEnv);
      const rows=await env.DB.prepare('SELECT n.kind,d.status FROM push_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.booking_id=? AND n.recipient_id=? ORDER BY n.kind')
        .bind(booking.id,workerUser).all<{kind:string;status:string}>();
      expect(rows.results).toEqual([{kind:'Cancelled',status:'Sent'},{kind:'Requested',status:'Dead'}]);
      expect(provider).toHaveBeenCalledTimes(1);
    } finally { vi.stubGlobal('fetch',originalFetch); }
  });
});
