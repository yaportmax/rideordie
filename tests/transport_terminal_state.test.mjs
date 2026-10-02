import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
const { Transport } = await import('../src/net/transport.js');

class Pc extends EventTarget {
  constructor() { super(); this.connectionState='new'; this.iceConnectionState='new'; this.listeners=new Map(); }
  addEventListener(type, fn) { super.addEventListener(type,fn); this.listeners.set(type,fn); }
  removeEventListener(type,fn) { super.removeEventListener(type,fn); if(this.listeners.get(type)===fn)this.listeners.delete(type); }
  state(connection,ice=connection) { this.connectionState=connection; this.iceConnectionState=ice; this.dispatchEvent(new Event('connectionstatechange')); }
  createDataChannel() { return { readyState:'open', close(){this.readyState='closed';} }; }
}
class Conn extends EventEmitter {
  constructor() { super(); this.open=false; this.closed=false; this.peerConnection=new Pc(); this.sent=[]; }
  openNow() { this.open=true; this.emit('open'); }
  close() { this.closed=true; if(!this.open)return; this.open=false; this.emit('close'); }
  send(data) { this.sent.push(data); }
}
class Peer extends EventEmitter {
  constructor() { super(); this.destroyed=false; this.disconnected=false; }
  openNow() { this.disconnected=false; this.emit('open'); }
  incoming(conn=new Conn()) { this.emit('connection',conn); return conn; }
  connect() { return this.outbound=new Conn(); }
  disconnect() { this.disconnected=true; this.emit('disconnected'); }
  reconnect() { this.disconnected=false; }
  destroy() { this.destroyed=true; this.emit('close'); }
}
async function setup(t) {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const tp=new Transport({PeerClass:Peer}); const lost=[];
  tp.onClose=()=>lost.push(true); t.after(()=>tp.destroy());
  const pending=tp.host('ABCDE'), peer=tp.peer; peer.openNow(); await pending;
  return {tp,peer,lost,tick:ms=>t.mock.timers.tick(ms)};
}
for(const [connection,ice] of [['failed','disconnected'],['closed','disconnected'],['connected','failed']]) {
  test(`terminal WebRTC ${connection}/${ice} releases opened seat exactly once without PeerJS close`,async t=>{
    const {tp,peer,lost,tick}=await setup(t); const conn=peer.incoming(); conn.openNow();
    conn.peerConnection.state(connection,ice); conn.emit('close'); conn.peerConnection.state('closed','closed'); tick(20000);
    assert.equal(lost.length,1); assert.equal(tp.conn,null); assert.equal(tp.open,false); assert.equal(conn.closed,true);
    assert.equal(tp.fast,null); assert.equal(tp._pingT,null); assert.equal(tp._seatT,null); assert.equal(tp._pcCleanup,null);
    assert.equal(conn.peerConnection.listeners.size,0); assert.equal(tp.peer,peer); assert.equal(tp.status,'waiting');
  });
}
test('transient ICE/P2P disconnection and signaling outage can recover without dropping the run',async t=>{
  const {tp,peer,lost,tick}=await setup(t); const conn=peer.incoming(); conn.openNow();
  conn.peerConnection.state('disconnected','disconnected'); peer.disconnect(); tick(500); peer.openNow();
  conn.peerConnection.state('connected','connected'); tick(20000);
  assert.equal(tp.conn,conn); assert.equal(tp.ready,true); assert.equal(lost.length,0); assert.equal(conn.closed,false);
  assert.equal(tp.send({alive:true}),true); assert.equal(conn.peerConnection.listeners.size,2);
});
test('destroy detaches native listeners and late queued terminal callbacks cannot close a replacement',async t=>{
  const {tp,peer,lost}=await setup(t); const old=peer.incoming(); old.openNow();
  const queued=old.peerConnection.listeners.get('connectionstatechange'); tp.closeConnection();
  const fresh=peer.incoming(); fresh.openNow(); old.peerConnection.connectionState='failed'; queued();
  assert.equal(tp.conn,fresh); assert.equal(tp.ready,true); assert.equal(lost.length,1); assert.equal(old.peerConnection.listeners.size,0);
  const queuedFresh=fresh.peerConnection.listeners.get('connectionstatechange'); tp.destroy();
  fresh.peerConnection.connectionState='closed'; queuedFresh();
  assert.equal(lost.length,1); assert.equal(fresh.peerConnection.listeners.size,0); assert.equal(tp._pcCleanup,null); assert.equal(tp._pingT,null);
});
test('pre-open terminal guest failure rejects join immediately and releases negotiation resources',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']}); const tp=new Transport({PeerClass:Peer}); t.after(()=>tp.destroy());
  let lost=0; tp.onClose=()=>lost++; const pending=tp.join('ABCDE'); const rejected=assert.rejects(pending,/multiplayer connection closed/);
  tp.peer.openNow(); const conn=tp.conn; conn.peerConnection.state('failed','disconnected'); await rejected;
  assert.equal(tp.conn,null); assert.equal(tp.peer,null); assert.equal(conn.closed,true); assert.equal(lost,0);
  assert.equal(tp._pcCleanup,null); assert.equal(conn.peerConnection.listeners.size,0); assert.equal(tp._seatT,null);
});
test('already terminal pre-open connection cannot become open from a stale open event',async t=>{
  const {tp,peer,lost}=await setup(t); const conn=new Conn(); conn.peerConnection.connectionState='failed';
  peer.incoming(conn); conn.openNow();
  assert.equal(tp.conn,null); assert.equal(tp.ready,false); assert.equal(lost.length,0); assert.equal(tp._pcCleanup,null); assert.equal(tp._seatT,null);
});
