import argparse, asyncio, fnmatch, io, json, math, os, re, shutil, sys, wave
from urllib.parse import urlsplit
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(os.getenv('PASHAMUSIC_TEST_REPO', Path(__file__).resolve().parents[1]))
BASE = os.getenv('PASHAMUSIC_TEST_URL', 'http://127.0.0.1:8911/music/')
FIXTURE_ORIGIN = '{0.scheme}://{0.netloc}'.format(urlsplit(BASE))
CHROMIUM_EXECUTABLE = os.getenv('PASHAMUSIC_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('chromium-browser')
REPORT = Path(os.getenv('PASHAMUSIC_TEST_REPORT', '/tmp/pasha-audio-recovery-results.json'))
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1'
TRACKS = [{'ownerId': 1, 'id': i + 1, 'title': f'Track {n}', 'artist': f'Artist {n}', 'duration': 180, 'fileUrl': f'{FIXTURE_ORIGIN}/test-{n}.wav'} for i, n in enumerate(['A', 'B'])]

SESSION = r'''(() => {
  localStorage.setItem('pashaMusicConnectionV1', JSON.stringify({backendUrl:'http://localhost:8787',apiKey:'test-only'}));
  window.__actions = {};
  window.__gesture=false;
  window.__remoteAction=null;
  Object.defineProperty(navigator,'userActivation',{configurable:true,value:{get isActive(){return __gesture},hasBeenActive:true}});
  window.__command=(name,details={},userGesture=true)=>{const previous=__remoteAction;__remoteAction=name;__gesture=userGesture;try{return __actions[name]({action:name,...details})}finally{__gesture=false;__remoteAction=previous}};
  const ms = navigator.mediaSession;
  if (!ms) Object.defineProperty(navigator, 'mediaSession', {configurable:true, value:{playbackState:'none',setActionHandler(){},setPositionState(){}}});
  const originalAction = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  navigator.mediaSession.setActionHandler = (name, fn) => { __actions[name] = fn; try { originalAction(name, fn); } catch {} };
  window.__positions=[];
  const originalPosition=navigator.mediaSession.setPositionState?.bind(navigator.mediaSession);
  navigator.mediaSession.setPositionState=data=>{__positions.push(data?{...data}:null);if(originalPosition)try{originalPosition(data)}catch{}};
  if (!window.MediaMetadata) window.MediaMetadata = class { constructor(data) { Object.assign(this, data); } };
  class AudioSession extends EventTarget {
    constructor(){super();this.state='active';this.types=[];this._type='auto'}
    get type(){return this._type}
    set type(v){this._type=v;this.types.push(v)}
    change(state){this.state=state;this.dispatchEvent(new Event('statechange'))}
  }
  window.__session = new AudioSession();
  Object.defineProperty(navigator, 'audioSession', {configurable:true,value:__session});
  window.__hidden=false;
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>__hidden});
})();'''

STRICT_MEDIA = r'''(() => {
  const models=new WeakMap(); let serial=0;
  function m(a){let v=models.get(a);if(!v){v={id:++serial,source:'',paused:true,ended:false,position:0,duration:NaN,ready:0,epoch:0,plays:0,loads:0,pauses:0,scriptPauses:0,seeks:0,playbackRate:1,rateWrites:0,seekTimeupdateFirst:false,unlocked:false,backgroundRevoked:false,clockFrozen:false,wakeWith:null,decoderWedged:false,lastLoadGesture:false,lastPlayGesture:false,events:[],next:'ok',pending:[],audible:false,metadataDelay:24,playingDelay:16,...window.__media?.options};models.set(a,v)}return v}
  function event(a,name){const v=m(a);v.events.push({name,position:v.position,time:performance.now(),epoch:v.epoch});a.dispatchEvent(new Event(name))}
  function cancel(a){const v=m(a);v.epoch++;v.audible=false;v.pending.splice(0).forEach(p=>p.reject(new DOMException('Superseded media operation','AbortError')))}
  function finish(a){const v=m(a);if(v.paused||!v.ready||v.blocked||v.next==='frozen')return;const epoch=v.epoch;setTimeout(()=>{if(epoch!==v.epoch||v.paused||v.blocked)return;v.audible=!v.clockFrozen;event(a,'playing');v.pending.splice(0).forEach(p=>p.resolve());if(!v.clockTimer)v.clockTimer=setInterval(()=>{if(v.audible&&!v.paused&&!v.clockFrozen){v.position+=.2;event(a,'timeupdate')}},200)},v.playingDelay)}
  function sourceLoad(a,source){const v=m(a);if(window.__media?.backgroundPolicy&&document.hidden&&!__gesture)v.backgroundRevoked=true;cancel(a);v.clockFrozen=false;v.wakeWith=null;v.decoderWedged=false;v.playbackRate=a.defaultPlaybackRate||1;v.source=source;v.ready=0;v.position=0;v.duration=NaN;v.ended=false;const epoch=v.epoch;setTimeout(()=>{if(epoch!==v.epoch)return;event(a,'abort');event(a,'emptied');},0);setTimeout(()=>{if(epoch!==v.epoch)return;v.ready=1;v.duration=180;event(a,'loadedmetadata');v.ready=4;event(a,'canplay');finish(a);},v.metadataDelay)}
  const proto=HTMLMediaElement.prototype;
  const nativeGetAttribute=Element.prototype.getAttribute;
  Element.prototype.getAttribute=function(name){if(this.tagName==='AUDIO'&&name==='src')return m(this).source||null;return nativeGetAttribute.call(this,name)};
  const nativeSetAttribute=Element.prototype.setAttribute;
  Element.prototype.setAttribute=function(name,value){if(this.tagName==='AUDIO'&&name==='src'){sourceLoad(this,String(value));return}return nativeSetAttribute.call(this,name,value)};
  const nativeRemove=Element.prototype.removeAttribute;
  Element.prototype.removeAttribute=function(name){if(this.tagName==='AUDIO'&&name==='src'){sourceLoad(this,'');return}return nativeRemove.call(this,name)};
  for(const name of ['src','currentSrc','paused','ended','currentTime','duration','readyState','networkState']){
    const old=Object.getOwnPropertyDescriptor(proto,name);
    const get=function(){if(this.tagName!=='AUDIO')return old.get.call(this);const v=m(this);return ({src:v.source,currentSrc:v.source,paused:v.paused,ended:v.ended,currentTime:v.position,duration:v.duration,readyState:v.ready,networkState:v.ready?1:2})[name]};
    const set=name==='src'?function(value){if(this.tagName!=='AUDIO')return old.set.call(this,value);sourceLoad(this,String(value))}:name==='currentTime'?function(value){if(this.tagName!=='AUDIO')return old.set.call(this,value);const v=m(this);if(!v.ready)throw new DOMException('No metadata','InvalidStateError');v.seeks++;if(v.clockFrozen&&v.wakeWith==='seek'){v.clockFrozen=false;v.wakeWith=null;v.audible=!v.paused}v.position=Number(value);v.ended=Number.isFinite(v.duration)&&v.position>=v.duration;setTimeout(()=>{event(this,'seeking');if(v.seekTimeupdateFirst)event(this,'timeupdate');event(this,'seeked');if(!v.seekTimeupdateFirst)event(this,'timeupdate')},0)}:old.set;
    Object.defineProperty(proto,name,{configurable:true,get,set});
  }
  const nativeRate=Object.getOwnPropertyDescriptor(proto,'playbackRate');
  Object.defineProperty(proto,'playbackRate',{configurable:true,
    get(){return this.tagName==='AUDIO'?m(this).playbackRate:nativeRate.get.call(this)},
    set(value){if(this.tagName!=='AUDIO')return nativeRate.set.call(this,value);const v=m(this);v.rateWrites++;v.playbackRate=Number(value);if(v.clockFrozen&&!v.decoderWedged&&v.wakeWith==='rate'){v.clockFrozen=false;v.wakeWith=null;v.audible=!v.paused}}
  });
  const nativePlay=proto.play,nativePause=proto.pause,nativeLoad=proto.load;
  proto.play=function(){
    if(this.tagName!=='AUDIO')return nativePlay.call(this);const v=m(this);v.plays++;v.lastPlayGesture=__gesture;
    // Opt-in fixture: a previously admitted element keeps background permission,
    // while cloning or deactivating its native player requires fresh activation.
    if(window.__media.backgroundPolicy&&document.hidden&&!__gesture&&(!v.unlocked||v.backgroundRevoked)){event(this,'permission-denied');return Promise.reject(new DOMException('Background player is not admitted','NotAllowedError'))}
    if(__gesture){v.unlocked=true;v.backgroundRevoked=false}
    // A scenario can explicitly model native repeat-play waking the old player.
    // This is not assumed for every stall or claimed as a platform guarantee.
    if(v.clockFrozen&&v.wakeWith==='play'){v.clockFrozen=false;v.wakeWith=null}
    const mode=window.__media.next||v.next;window.__media.next=null;v.next=mode==='frozen'?'frozen':'ok';v.blocked=mode==='hold'||mode==='frozen';
    if(mode==='deny')return Promise.reject(new DOMException('Autoplay blocked','NotAllowedError'));if(mode==='expire')return Promise.reject(new DOMException('Bad URL','NotSupportedError'));
    // Opt-in physical-trace reproduction: an already-loaded native decoder
    // reports playing while its clock stays wedged despite rate commands.
    // Loading a fresh native epoch clears the wedge; cold Play stays healthy.
    if(window.__media.remoteDecoderWedge&&document.hidden&&window.__remoteAction==='play'&&v.ready>=3){v.decoderWedged=true;v.clockFrozen=true;v.audible=false}
    v.paused=false;setTimeout(()=>event(this,'play'),0);if(mode==='promise-only'){finish(this);return Promise.resolve()}return new Promise((resolve,reject)=>{v.pending.push({resolve,reject});if(mode!=='hold'&&mode!=='frozen')finish(this)})
  };
  proto.pause=function(){if(this.tagName!=='AUDIO')return nativePause.call(this);const v=m(this);v.pauses++;if(!window.__media.externalOperation){v.scriptPauses++;if(window.__media.backgroundPolicy&&document.hidden&&!__gesture)v.backgroundRevoked=true}if(v.paused)return;v.paused=true;v.audible=false;v.pending.splice(0).forEach(p=>p.reject(new DOMException('Paused pending play','AbortError')));setTimeout(()=>event(this,'pause'),0)};
  proto.load=function(){if(this.tagName!=='AUDIO')return nativeLoad.call(this);const v=m(this);v.loads++;v.lastLoadGesture=__gesture;sourceLoad(this,v.source)};
  window.__media={model:m,event,next:null,options:{},backgroundPolicy:false,externalOperation:false,remoteDecoderWedge:false,
    allowExistingBackground(a){this.backgroundPolicy=true;const v=m(a);v.unlocked=true;v.backgroundRevoked=false},
    nativeStall(a,wakeWith=null){const v=m(a);v.paused=false;v.clockFrozen=true;v.audible=false;v.wakeWith=wakeWith;event(a,'playing')},
    releaseNativeStall(a){const v=m(a);v.clockFrozen=false;v.audible=!v.paused;event(a,'timeupdate')},
    advance(a,position){const v=m(a);v.position=position;event(a,'timeupdate')},metadataReady(a){const v=m(a);v.ready=1;v.duration=180;event(a,'loadedmetadata');v.ready=4;event(a,'canplay');finish(a)},
    externalPause(a){this.externalOperation=true;try{a.pause()}finally{this.externalOperation=false}},freeze(a){const v=m(a);v.audible=false;v.next='frozen'},forcePaused(a){m(a).paused=false},
    snapshot(a){const v=m(a);return {id:v.id,source:v.source,paused:v.paused,position:v.position,ready:v.ready,plays:v.plays,loads:v.loads,scriptPauses:v.scriptPauses,seeks:v.seeks,playbackRate:v.playbackRate,rateWrites:v.rateWrites,unlocked:v.unlocked,backgroundRevoked:v.backgroundRevoked,clockFrozen:v.clockFrozen,decoderWedged:v.decoderWedged,lastLoadGesture:v.lastLoadGesture,lastPlayGesture:v.lastPlayGesture,audible:v.audible,events:v.events.slice(-12)}}};
})();'''

COMMON = r'''window.__test.assert=(condition,message)=>{if(!condition)throw Error(message)};
window.__test.wait=(ms=35)=>new Promise(resolve=>setTimeout(resolve,ms));
window.__test.until=async(check,message,timeout=2200)=>{let start=performance.now();while(!check()){if(performance.now()-start>timeout)throw Error(message);await __test.wait(15)}};
window.__test.audio=()=>__test.elements.audio;
window.__test.model=()=>__media.model(__test.audio());
window.__test.start=async(tracks)=>{await __test.playTrack(tracks[0],tracks);await __test.until(()=>__test.model().audible,'initial playing event');__media.advance(__test.audio(),43);await __test.wait()};'''

SCENARIOS = {
 'remote_manual_play_reloads_wedged_decoder_inside_activation': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),source=model.source,loads=model.loads,epoch=model.epoch,rateWrites=model.rateWrites;
   __media.allowExistingBackground(audio);__media.remoteDecoderWedge=true;
   __hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.advance(audio,5.45);__media.externalPause(audio);await t.wait(45);
   await audio.play();await t.until(()=>model.audible&&model.position>5.5,'native microphone-end resume advances without rebuilding its decoder',500);
   t.assert(model.loads===loads&&model.epoch===epoch&&model.rateWrites===rateWrites,'successful automatic microphone resume must retain its original native player');
   audio.playbackRate=1.25;__media.advance(audio,9.60);
   for(let cycle=0;cycle<3;cycle++){
     __command('pause',{},true);await t.wait(320);
     t.assert(model.paused&&navigator.mediaSession.playbackState==='paused','each manual remote Pause is respected');
     const position=model.position,priorLoads=model.loads,priorPlays=model.plays;
     __command('play',{},true);
     const synchronous={audio:t.audio(),loads:model.loads,plays:model.plays,loadGesture:model.lastLoadGesture,playGesture:model.lastPlayGesture};
     await t.until(()=>model.audible&&model.position>position+.05,'the rebuilt native decoder must restore its checkpoint and advance promptly',700);
     t.assert(synchronous.audio===audio&&synchronous.loads===priorLoads+1&&synchronous.plays===priorPlays+1&&synchronous.loadGesture&&synchronous.playGesture,'manual background Play must load and play the original element synchronously before activation expires');
     t.assert(model.source===source&&Math.abs(model.position-position)<1&&model.playbackRate===1.25&&!audio.muted&&audio.volume===1,'same-element restart preserves source, checkpoint, speed and normal gain');
     const repairedLoads=model.loads,repairedEpoch=model.epoch;
     __media.event(audio,'playing');__media.event(audio,'playing');await t.wait(20);
     t.assert(model.loads===repairedLoads&&model.epoch===repairedEpoch,'duplicate playing notifications must not trigger another native reload');
   }
   t.assert(navigator.mediaSession.playbackState==='playing','healthy resumed clock restores the system Playing state');
 }''',
 'remote_decoder_restart_is_not_applied_to_normal_ui_play': r'''async tracks=>{
   const t=__test;await t.start(tracks);__media.remoteDecoderWedge=true;
   const audio=t.audio(),model=t.model(),writes=model.rateWrites,loads=model.loads,epoch=model.epoch;
   t.pausePlayback();await t.wait(40);const position=model.position;
   document.getElementById('miniPlayButton').click();
   await t.until(()=>model.audible&&model.position>position+.05,'ordinary foreground UI Play advances without decoder replacement',500);
   t.assert(model.rateWrites===writes&&t.audio()===audio&&model.loads===loads&&model.epoch===epoch,'UI Play must preserve the existing player without the system-only decoder restart');
 }''',
 'remote_pause_cancels_pending_cold_decoder_restart': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),source=model.source;__media.allowExistingBackground(audio);__media.remoteDecoderWedge=true;
   __hidden=true;document.dispatchEvent(new Event('visibilitychange'));__command('pause',{},true);await t.wait(320);
   const checkpoint=model.position;model.playingDelay=150;
   __command('play',{},true);await t.wait(50);__command('pause',{},true);await t.wait(125);
   t.assert(navigator.mediaSession.playbackState==='paused'&&document.getElementById('playButton').getAttribute('aria-label')==='Воспроизвести','actual cold playing during manual Pause grace must not republish Playing');
   await t.wait(225);
   t.assert(model.paused&&!model.audible&&navigator.mediaSession.playbackState==='paused','manual Pause must cancel the cold restart before its delayed playing event');
   model.paused=false;__media.event(audio,'playing');__media.advance(audio,147);await t.wait(35);
   t.assert(model.paused&&!model.audible&&document.getElementById('currentTime').textContent==='0:43','late native playing/timeupdate must not undo Pause or overwrite the frozen checkpoint');
   model.playingDelay=16;__command('play',{},true);await t.until(()=>model.audible,'a fresh manual activation restarts after the cancelled cold player',700);
   t.assert(t.audio()===audio&&model.source===source&&Math.abs(model.position-checkpoint)<1,'cancelled restart keeps the original element and pre-load checkpoint for the next Play');
 }''',
 'remote_next_track_cancels_pending_cold_decoder_restart': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model();__media.allowExistingBackground(audio);__media.remoteDecoderWedge=true;
   __hidden=true;document.dispatchEvent(new Event('visibilitychange'));__command('pause',{},true);await t.wait(320);
   model.metadataDelay=200;model.playingDelay=40;
   __command('play',{},true);await t.wait(20);__command('nexttrack',{},true);
   await t.until(()=>t.state.currentTrack.id===2&&t.model().audible,'Next owns playback while the old cold metadata is pending',700);
   const nextEpoch=model.epoch,nextLoads=model.loads;await t.wait(150);__media.event(audio,'playing');await t.wait(35);
   t.assert(t.audio()===audio&&t.state.currentTrack.id===2&&model.source.endsWith('test-B.wav')&&model.position<1,'late old metadata cannot restore the previous source or seek its checkpoint onto Next');
   t.assert(model.audible&&model.epoch===nextEpoch&&model.loads===nextLoads,'old cold-restart cleanup must not reload or pause the new track');
 }''',
 'remote_manual_play_during_known_capture_keeps_native_decoder': r'''async tracks=>{
   const t=__test;await t.start(tracks);const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __session.change('interrupted');__media.externalPause(audio);await t.wait(40);t.pausePlayback();await t.wait(40);
   const plays=model.plays;__media.next='hold';__command('play',{},true);await t.wait(80);
   t.assert(model.plays===plays+1&&t.audio()===audio&&model.loads===loads&&model.epoch===epoch,'explicit Play during a known microphone capture may reach native Play but must not rebuild its player');
   t.pausePlayback();
 }''',
 'hidden_seek_jump_does_not_fake_native_clock_progress': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch,pauses=model.scriptPauses,plays=model.plays;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio);
   await t.until(()=>t.model().plays===plays+1,'the stalled clock has received its one background wake',4000);await t.wait(2600);
   // WebKit finishSeek queues timeupdate before seeked with seeking already
   // cleared. The jump itself must not be accepted as post-capture clock gain.
   model.seekTimeupdateFirst=true;__command('seekto',{seekTime:80},true);await t.wait(650);
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch&&t.model().scriptPauses===pauses&&!t.model().audible,'seek must not mutate or replace the stalled native decoder');
   t.assert(navigator.mediaSession.playbackState==='playing','seek refreshes the observation grace and cancels its previous clock deadline');
   const records=JSON.parse(getMusicPlaybackDiagnostics()).events;
   t.assert(!records.some(event=>event.event==='clock-progress'&&event.detail==='wake'),'a timeupdate caused solely by seek must not claim resumed native playback');
   await t.wait(2700);
   const last=JSON.parse(getMusicPlaybackDiagnostics()).events.at(-1);
   t.assert(last.wanted&&Math.abs(last.checkpoint-80)<.6&&navigator.mediaSession.playbackState==='paused','unchanged native clock after seek must remain stalled at the new80s checkpoint');
   t.assert(t.model().plays===plays+1,'seeking a stalled background player must not create another automatic wake probe');
   __command('play',{},true);await t.until(()=>t.model().audible,'SystemPlay repairs at the user-selected checkpoint',800);
   t.assert(t.audio()===audio&&Math.abs(t.model().position-80)<.8,'control recovery restores the seek target, not the pre-seek interruption position');
 }''',
 'hidden_denied_clock_probe_preserves_original_and_waits_for_control': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch,pauses=model.scriptPauses,plays=model.plays;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio);__media.next='deny';await t.wait(6500);
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch&&t.model().scriptPauses===pauses&&!t.model().paused&&!t.model().backgroundRevoked,'a denied background clock wake must not deactivate, replace or lose admission of the original player');
   t.assert(t.model().plays===plays+1&&navigator.mediaSession.playbackState==='paused','denied clock probe has no retry loop and provides a usable system Play');
   const diagnostic=JSON.parse(getMusicPlaybackDiagnostics()).events;
   t.assert(diagnostic.some(event=>event.event==='background-clock-wake-rejected'&&event.detail==='NotAllowedError')&&diagnostic.at(-1).wanted,'diagnostic must distinguish native denial from decoder corruption while preserving intent');
   __command('play',{},true);await t.until(()=>t.model().audible,'a new control activation can recover after the denied native wake',800);
   t.assert(t.audio()===audio&&Math.abs(t.model().position-43)<.8,'new Control Play retains the original native element and checkpoint');
 }''',
 'hidden_system_play_supersedes_pending_clock_probe': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),plays=model.plays;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio);__media.next='hold';
   await t.until(()=>t.model().plays===plays+1,'the background wake probe has begun',4000);await t.wait(35);
   __command('play',{},true);await t.until(()=>t.model().audible,'fresh SystemPlay repairs without waiting for the old pending probe',800);
   t.assert(t.audio()===audio&&!t.model().backgroundRevoked&&Math.abs(t.model().position-43)<.8,'new control activation owns the original admitted decoder and checkpoint');
   const repairedEpoch=t.model().epoch,repairedLoads=t.model().loads,repairedPlays=t.model().plays;
   await t.wait(3800);
   t.assert(t.model().audible&&t.model().epoch===repairedEpoch&&t.model().loads===repairedLoads&&t.model().plays===repairedPlays,'late rejection and clock timer from the replaced probe cannot pause, reload or replay the new command');
 }''',
 'hidden_rate_probe_wakes_original_native_player_without_time_change': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch,pauses=model.scriptPauses,seeks=model.seeks,plays=model.plays,rateWrites=model.rateWrites,rate=model.playbackRate;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio,'rate');
   await t.until(()=>t.model().audible&&t.model().position>43.05,'same-value rate probe wakes the admitted native player',4500);
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch&&t.model().scriptPauses===pauses&&t.model().seeks===seeks,'a native rate wake must retain source, decoder, time and background permission');
   t.assert(t.model().rateWrites===rateWrites+1&&t.model().playbackRate===rate&&t.model().plays===plays+1,'one background clock episode reasserts the unchanged rate and invokes existing Play exactly once');
   t.assert(__session.types.every(type=>type==='playback')&&navigator.mediaSession.playbackState==='playing','wake retains the playback category and system state');
 }''',
 'hidden_late_watchdog_timer_grants_fresh_native_grace': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch,pauses=model.scriptPauses,plays=model.plays;
   const now=performance.now.bind(performance);let suspendedTime=0;
   Object.defineProperty(performance,'now',{configurable:true,value:()=>now()+suspendedTime});
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio);await t.wait(2600);
   // Model an overdue timer delivered before the native post-capture clock has
   // had any running time. This offset does not expire real JS timers early.
   suspendedTime=5000;await t.wait(700);
   t.assert(t.model().plays===plays,'a watchdog timer delayed by suspension must provide fresh clock grace before probing');
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch&&t.model().scriptPauses===pauses,'overdue timer must not deactivate the newly resumed background player');
   __media.releaseNativeStall(audio);await t.wait(500);
   t.assert(t.model().audible&&t.model().position>43.1&&t.model().plays===plays,'native clock recovers within fresh post-suspension grace without a script Play');
 }''',
 'hidden_native_clock_delayed_2200_keeps_admitted_decoder': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),loads=t.model().loads,epoch=t.model().epoch,pauses=t.model().scriptPauses;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio);
   setTimeout(()=>__media.releaseNativeStall(audio),2200);await t.wait(2700);
   t.assert(t.model().audible&&t.model().position>43.1,'delayed native clock must recover while the app remains backgrounded');
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch&&t.model().scriptPauses===pauses,'2.2s native resume must preserve the admitted decoder without load, source assignment, script pause or clone');
   t.assert(navigator.mediaSession.playbackState==='playing','delayed successful native clock must preserve Control Center Playing');
 }''',
 'hidden_play_probe_wakes_original_decoder_without_reset': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch,pauses=model.scriptPauses,plays=model.plays;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio,'play');
   await t.until(()=>t.model().audible&&t.model().position>43.05,'one background same-element play probe wakes the admitted native player',4500);
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch&&t.model().scriptPauses===pauses,'automatic background probe must never deactivate or replace the native player');
   t.assert(t.model().plays===plays+1,'one stalled episode permits only one play-only probe');
   t.assert(navigator.mediaSession.playbackState==='playing','recovered original clock retains the system Playing state');
 }''',
 'hidden_stall_defers_decoder_reset_until_explicit_system_play': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch,pauses=model.scriptPauses,plays=model.plays;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio);await t.wait(6500);
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch&&t.model().scriptPauses===pauses&&!t.model().paused,'a confirmed hidden stall must retain its admitted native decoder after both observation windows');
   t.assert(t.model().plays===plays+1&&!t.model().audible,'persistent hidden stall must be bounded to one same-element probe');
   t.assert(navigator.mediaSession.playbackState==='paused','confirmed stalled clock must offer Play in Control Center');
   const diagnostic=JSON.parse(getMusicPlaybackDiagnostics()).events.at(-1);
   t.assert(diagnostic.wanted&&Math.abs(diagnostic.checkpoint-43)<.6,'deferred background repair keeps playback intent and interruption checkpoint');
   __command('play',{},true);await t.until(()=>t.model().audible&&t.model().position>=43,'fresh explicit SystemPlay can repair the existing admitted element',1700);
   t.assert(t.audio()===audio&&t.model().loads>loads&&!t.model().backgroundRevoked,'confirmed stalled Control Play must reset the same original element while its activation is live');
   t.assert(Math.abs(t.model().position-43)<1&&navigator.mediaSession.playbackState==='playing','explicit recovery retains the capture checkpoint and updates the widget');
 }''',
 'hidden_long_probe_preserves_decoder_and_intent': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch,pauses=model.scriptPauses,plays=model.plays;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio);__media.next='hold';await t.wait(6500);
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch&&t.model().scriptPauses===pauses,'a pending background probe must not become decoder failure or mutate the native player');
   t.assert(t.model().plays===plays+1&&!t.model().audible,'long pending background probe is bounded to one play call');
   const diagnostic=JSON.parse(getMusicPlaybackDiagnostics()).events.at(-1);
   t.assert(diagnostic.wanted&&Math.abs(diagnostic.checkpoint-43)<.6,'pending probe timeout retains the interruption checkpoint and resume intent');
   __command('play',{},true);await t.until(()=>t.model().audible,'a fresh Control Center activation bypasses the old pending probe',1700);
   t.assert(t.audio()===audio&&Math.abs(t.model().position-43)<1,'new Control Play keeps original element and checkpoint after a timed out probe');
 }''',
 'hidden_repeated_playing_events_keep_one_clock_episode': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch,pauses=model.scriptPauses,plays=model.plays;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio);
   const storm=setInterval(()=>{__media.event(audio,'playing');document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));},240);
   try{await t.wait(6500)}finally{clearInterval(storm)}
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch&&t.model().scriptPauses===pauses,'a native playing/visibility event storm must preserve the background player');
   t.assert(t.model().plays===plays+1&&!t.model().audible,'repeated Playing without clock progress must not restart observation or create automatic retry loops');
   t.assert(navigator.mediaSession.playbackState==='paused','event storms must not disguise a confirmed clock stall as Playing');
 }''',
 'hidden_manual_pause_cancels_clock_observation': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch;
   __media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio);await t.wait(2100);
   t.pausePlayback();const plays=t.model().plays;await t.wait(4500);
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch,'Pause during native clock grace must retain the original source and decoder');
   t.assert(t.model().paused&&!t.model().audible&&t.model().plays===plays&&navigator.mediaSession.playbackState==='paused','manual Pause must cancel pending clock observation and every automatic play probe');
 }''',
 'hidden_next_track_cancels_old_clock_observation': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio();__media.allowExistingBackground(audio);__hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   __media.externalPause(audio);await t.wait(45);__media.nativeStall(audio);await t.wait(2100);
   __command('nexttrack',{},true);await t.until(()=>t.state.currentTrack.id===2&&t.model().audible,'user Next starts the selected track during old clock grace',800);
   const next=t.audio(),epoch=t.model().epoch,loads=t.model().loads,plays=t.model().plays;
   await t.wait(4500);
   t.assert(t.audio()===next&&t.state.currentTrack.id===2&&t.model().source.endsWith('test-B.wav'),'expired previous clock observation must not restore the old track');
   t.assert(t.model().audible&&t.model().epoch===epoch&&t.model().loads===loads&&t.model().plays===plays&&t.model().position<6,'Next owns decoder and position while the old stalled episode expires');
 }''',
 'native_resume_without_session_state_keeps_decoder': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);
   const audio=t.audio(),loads=t.model().loads,epoch=t.model().epoch;
   __media.externalPause(audio);await t.wait(60);__session.dispatchEvent(new Event('statechange'));
   await audio.play();await t.until(()=>t.model().audible,'native playback resumes after external voice capture');__session.dispatchEvent(new Event('statechange'));await t.wait(60);
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch,'native playing with unsupported AudioSession.state must preserve source and decoder');
   t.assert(document.getElementById('playButton').getAttribute('aria-label')==='Пауза'&&navigator.mediaSession.playbackState==='playing','native resume must restore player and Control Center state');
   t.assert(Math.abs(t.model().position-43)<.6,'native resume retains the microphone interruption position');
 }''',
 'system_pause_then_native_pause_without_session_state': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);const audio=t.audio(),loads=t.model().loads,epoch=t.model().epoch;
   __command('pause',{},false);
   t.assert(navigator.mediaSession.playbackState==='paused','capture Pause must immediately exposePlay in Control Center');
   __media.externalPause(audio);await t.wait(400);
   t.assert(t.model().paused&&!t.model().audible,'capture keeps audio paused beyond the manual Pause grace period');
   await audio.play();await t.until(()=>t.model().audible,'native resume retains intent after system Pause precedes native audio Pause');await t.wait(40);
   t.assert(t.model().loads===loads&&t.model().epoch===epoch&&Math.abs(t.model().position-43)<.6,'missing-state capture resume preserves the original decoder and checkpoint');
   t.assert(document.getElementById('playButton').getAttribute('aria-label')==='Пауза','native resume must restore visible playing state');
 }''',
 'native_pause_then_system_pause_without_session_state': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);const audio=t.audio(),loads=t.model().loads,epoch=t.model().epoch;
   __media.externalPause(audio);await t.wait(35);__command('pause',{},false);
   t.assert(navigator.mediaSession.playbackState==='paused','capture Pause after native pause must immediately exposePlay in Control Center');
   await t.wait(400);t.assert(t.model().paused&&!t.model().audible,'capture must remain paused without erasing auto-resume intent');
   await audio.play();await t.until(()=>t.model().audible,'native resume retains intent when native Pause precedes system Pause');await t.wait(40);
   t.assert(t.model().loads===loads&&t.model().epoch===epoch&&Math.abs(t.model().position-43)<.6,'late system Pause must not erase the captured checkpoint');
   t.assert(document.getElementById('playButton').getAttribute('aria-label')==='Пауза','native resume must restore visible playing state');
 }''',
 'manual_system_pause_without_session_state_stays_paused': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);__command('pause',{},true);
   t.assert(navigator.mediaSession.playbackState==='paused','manual Pause without session state publishes paused synchronously');await t.wait(400);
   const plays=t.model().plays;__session.dispatchEvent(new Event('statechange'));window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));await t.wait(200);
   t.assert(t.model().paused&&!t.model().audible&&t.model().plays===plays,'ordinary manual Pause without a native capture pause must suppress auto-resume');
 }''',
 'short_native_capture_resume_cancels_pause_grace': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);const audio=t.audio(),loads=t.model().loads,epoch=t.model().epoch;
   __command('pause',{},false);__media.externalPause(audio);await t.wait(35);
   await audio.play();await t.until(()=>t.model().audible,'short microphone capture resumes natively before Pause grace expires');await t.wait(320);
   t.assert(t.model().audible&&!t.model().paused&&navigator.mediaSession.playbackState==='playing','expired Pause grace must not stop accepted short native resume');
   t.assert(t.model().loads===loads&&t.model().epoch===epoch&&t.audio()===audio,'short capture must retain the native decoder');
 }''',
 'long_opaque_capture_probe_does_not_reset_decoder': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);const audio=t.audio(),loads=t.model().loads,epoch=t.model().epoch;
   __hidden=true;document.dispatchEvent(new Event('visibilitychange'));__media.externalPause(audio);await t.wait(45);
   __media.next='hold';__session.dispatchEvent(new Event('statechange'));await t.wait(40);__media.advance(audio,95);
   await t.until(()=>JSON.parse(getMusicPlaybackDiagnostics()).events.some(event=>event.event==='resume-held-for-capture'),'opaque automatic probe reaches its bounded capture hold',1200);
   const last=JSON.parse(getMusicPlaybackDiagnostics()).events.at(-1);
   t.assert(!t.model().audible&&t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch,'a long pending play without session state must not reset or replace the native player');
   t.assert(last.wanted&&Math.abs(last.checkpoint-43)<.6&&document.getElementById('currentTime').textContent==='0:43','opaque timeout must preserve auto-resume intent and frozen checkpoint');
   t.assert(navigator.mediaSession.playbackState==='playing','a delayed opaque timeout must preserve native MediaSession auto-resume state');
   __command('play',{},true);await t.until(()=>t.model().audible,'Control Center Play recovers after long opaque capture');
   t.assert(t.model().loads===loads&&t.model().epoch===epoch&&Math.abs(t.model().position-43)<.6,'post-capture Play restores the checkpoint without replacing the decoder');
 }''',
 'opaque_automatic_denial_preserves_native_resume_state': r'''async tracks=>{
   const t=__test;delete __session.state;await t.start(tracks);const audio=t.audio(),loads=t.model().loads,epoch=t.model().epoch;
   __hidden=true;document.dispatchEvent(new Event('visibilitychange'));__media.externalPause(audio);await t.wait(45);
   __media.next='deny';__session.dispatchEvent(new Event('statechange'));
   await t.until(()=>JSON.parse(getMusicPlaybackDiagnostics()).events.some(event=>event.event==='resume-held-for-capture'),'opaque automatic denial preserves its native interruption',600);
   const last=JSON.parse(getMusicPlaybackDiagnostics()).events.at(-1);
   t.assert(navigator.mediaSession.playbackState==='playing'&&last.wanted&&Math.abs(last.checkpoint-43)<.6,'automatic opaque denial must not overwrite native Playing or erase resume intent');
   t.assert(t.model().paused&&!t.model().audible&&t.model().loads===loads&&t.model().epoch===epoch,'denied automatic probe must retain the paused native decoder');
   await audio.play();await t.until(()=>t.model().audible,'native playing recovers after the opaque automatic denial');await t.wait(40);
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch&&Math.abs(t.model().position-43)<.6,'native resume after opaque denial keeps decoder and checkpoint');
   t.assert(document.getElementById('playButton').getAttribute('aria-label')==='Пауза','native resume after capture restores visible playing state');
 }''',
 'system_play_healthy_paused_element_keeps_decoder': r'''async tracks=>{
   const t=__test;await t.start(tracks);t.pausePlayback();await t.wait();
   const audio=t.audio(),loads=t.model().loads,epoch=t.model().epoch;
   __command('play',{},true);await t.until(()=>t.model().audible,'Control Center Play resumes a healthy paused element');await t.wait(40);
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch,'a healthy Control Center Play must not assign src or call load');
   t.assert(Math.abs(t.model().position-43)<.6,'play-first resume retains current position');
 }''',
 'play_first_waits_for_metadata_to_restore_checkpoint': r'''async tracks=>{
   const t=__test;await t.start(tracks);__media.externalPause(t.audio());await t.wait(50);
   const audio=t.audio(),model=t.model(),loads=model.loads,epoch=model.epoch;
   model.ready=0;model.position=0;model.duration=NaN;
   __command('play',{},true);setTimeout(()=>__media.metadataReady(audio),80);
   await t.until(()=>t.model().audible,'existing decoder resumes after delayed metadata');await t.wait(40);
   t.assert(Math.abs(t.model().position-43)<.6,'metadata arriving after Play must restore the43s interruption checkpoint');
   t.assert(t.audio()===audio&&t.model().loads===loads&&t.model().epoch===epoch,'delayed metadata must not require source reset');
 }''',
 'system_play_retries_despite_cached_interrupted_state': r'''async tracks=>{
   const t=__test;await t.start(tracks);__session.change('interrupted');__media.externalPause(t.audio());await t.wait(60);
   const plays=t.model().plays;
   __command('play',{},true);await t.until(()=>t.model().plays>plays,'Control Center Play must reach audio.play despite cached interrupted state',180);
   await t.until(()=>t.model().audible,'a successful Play must not await an absent AudioSession statechange');await t.wait(40);
   t.assert(__session.state==='interrupted'&&document.getElementById('playButton').getAttribute('aria-label')==='Пауза','accepted playback takes precedence over the stale AudioSession snapshot');
   t.assert(Math.abs(t.model().position-43)<.6,'authoritative Play keeps interruption checkpoint');
 }''',
 'system_play_supersedes_pending_background_attempt': r'''async tracks=>{
   const t=__test;await t.start(tracks);t.pausePlayback();await t.wait();
   __media.next='hold';window.__pending=t.resumePlayback(true);await t.wait(40);const plays=t.model().plays;
   __command('play',{},true);await t.until(()=>t.model().plays>plays,'fresh Control Center Play must replace the old pending attempt',180);
   await t.until(()=>t.model().audible,'fresh command starts playback without waiting for the old timeout',240);
   t.assert(Math.abs(t.model().position-43)<.6,'superseding a background attempt preserves its checkpoint');
   await t.wait(400);t.assert(t.model().audible,'late cancellation from the replaced attempt cannot stop the new command');
 }''',
 'native_playing_and_clock_override_stale_session_state': r'''async tracks=>{
   const t=__test;await t.start(tracks);const audio=t.audio(),loads=t.model().loads,epoch=t.model().epoch;
   __session.change('interrupted');__media.externalPause(audio);await t.wait(60);
   await audio.play();await t.until(()=>t.model().audible,'native auto-resume plays while DOM state is stale');await t.wait(260);
   t.assert(__session.state==='interrupted'&&t.model().position>43.1,'the native clock progresses despite cached interrupted state');
   t.assert(t.model().loads===loads&&t.model().epoch===epoch&&t.audio()===audio,'confirmed native playing must not trigger a decoder reset');
   t.assert(document.getElementById('playButton').getAttribute('aria-label')==='Пауза','native playing and time progression restore the visible playing state');
 }''',
 'audio_session_type_stays_playback_through_recovery': r'''async tracks=>{
   const t=__test;await t.start(tracks);__session.change('interrupted');__media.externalPause(t.audio());await t.wait(50);
   __session.change('active');await t.until(()=>t.model().audible,'normal interruption recovery');
   t.pausePlayback();await t.wait();__command('play',{},true);await t.until(()=>t.model().audible,'explicit replay after recovery');
   t.assert(__session.types.length>0&&__session.types.every(type=>type==='playback'),'recovery must keep AudioSession.type playback, never cycle through auto');
 }''',
 'repeated_interruption_frozen_checkpoint': r'''async tracks=>{
   const t=__test;await t.start(tracks);const a=t.audio();const loads=t.model().loads;__session.change('interrupted');t.model().audible=false;await t.wait();
   t.assert(t.model().loads===loads,'microphone interruption must not reset decoder while capture owns audio');
   __media.advance(a,95);__session.change('interrupted');await t.wait();
   t.assert(document.getElementById('currentTime').textContent==='0:43','repeated interruption must freeze the first 43s checkpoint');
   __session.change('active');await t.until(()=>t.model().audible,'session resumes');
   t.assert(Math.abs(t.model().position-43)<.5,'resume must restore the first checkpoint after repeated events');
 }''',
 'interrupted_ended_decoder_does_not_skip_track': r'''async tracks=>{
   const t=__test;await t.start(tracks);__session.change('interrupted');t.model().audible=false;__media.advance(t.audio(),180);t.model().ended=true;__media.event(t.audio(),'ended');await t.wait();
   t.assert(t.state.currentTrack.id===1,'silent interrupted decoder reaching end must not skip original track');__session.change('active');await t.until(()=>t.model().audible,'ended decoder repairs after capture');t.assert(t.state.currentTrack.id===1&&Math.abs(t.model().position-43)<.5&&!t.model().ended,'repair restores original track checkpoint');
 }''',
 'interruption_to_inactive_recovers_once': r'''async tracks=>{
   const t=__test;await t.start(tracks);__session.change('interrupted');t.model().audible=false;await t.wait();__session.change('inactive');await t.until(()=>t.model().audible,'interrupted to inactive must recover');
   const plays=t.model().plays;__session.change('active');window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));await t.wait(100);t.assert(t.model().plays===plays,'duplicate wake notifications must not restart recovered track');
 }''',
 'suspended_pause_timer_preserves_intent': r'''async tracks=>{
   const t=__test;await t.start(tracks);__command('pause',{},false);__media.externalPause(t.audio());
   t.agePendingPause();await t.wait(280);
   __session.change('interrupted');await t.wait(35);__session.change('inactive');
   await t.until(()=>t.model().audible,'queued interruption after suspended timer must preserve resume intent');
   t.assert(Math.abs(t.model().position-43)<.5,'long capture timer must preserve the first checkpoint');
 }''',
 'system_pause_before_audio_session_event': r'''async tracks=>{
   const t=__test;await t.start(tracks);__command('pause',{},false);
   __session.change('interrupted');await t.wait(90);__session.change('active');
   await t.until(()=>t.model().audible,'system interruption pause arriving before AudioSession must auto-resume');
   t.assert(Math.abs(t.model().position-43)<.5,'system interruption must resume at checkpoint');
 }''',
 'automatic_recovery_waits_for_microphone': r'''async tracks=>{
   const t=__test;await t.start(tracks);__command('pause',{},false);
   t.assert(navigator.mediaSession.playbackState==='paused','system Pause must publish paused synchronously so the widget exposesPlay');
   __session.change('interrupted');t.model().audible=false;await t.wait();
   const plays=t.model().plays,loads=t.model().loads;__session.change('interrupted');window.dispatchEvent(new Event('focus'));await t.wait(80);
   t.assert(t.model().plays===plays&&t.model().loads===loads,'automatic recovery must wait while microphone owns known interrupted session');
   __session.change('active');await t.until(()=>t.model().audible,'automatic recovery resumes remembered intent');t.assert(Math.abs(t.model().position-43)<.5,'automatic recovery restores checkpoint');
 }''',
 'native_auto_play_without_audio_session': r'''async tracks=>{
   const t=__test;Object.defineProperty(navigator,'audioSession',{configurable:true,value:undefined});await t.start(tracks);
   __hidden=true;document.dispatchEvent(new Event('visibilitychange'));__command('pause',{},false);__media.externalPause(t.audio());await t.wait(100);
   __hidden=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));__command('play',{},true);
   await t.until(()=>t.model().audible,'native automatic Play without AudioSession must recover');
   t.assert(Math.abs(t.model().position-43)<.5,'fallback restores checkpoint');
 }''',
 'manual_control_center_pause_stays_paused': r'''async tracks=>{
   const t=__test;await t.start(tracks);__command('pause',{},true);
   t.assert(navigator.mediaSession.playbackState==='paused','a manual Control Center Pause must publish its state inside the callback');await t.wait(320);
   const p=t.model().plays;__session.change('active');window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));await t.wait(250);
   t.assert(t.model().paused&&!t.model().audible&&t.model().plays===p,'explicit Control Center pause must remain paused');
 }''',
 'late_playing_event_does_not_undo_manual_pause': r'''async tracks=>{
   const t=__test;await t.start(tracks);__command('pause',{},true);await t.wait(320);__session.change('active');__media.event(t.audio(),'playing');await t.wait(180);
   t.assert(t.model().paused&&!t.model().audible,'late native playing event must respect confirmed manual pause intent');
 }''',
 'manual_ui_pause_during_interruption': r'''async tracks=>{
   const t=__test;await t.start(tracks);__session.change('interrupted');await t.wait();t.pausePlayback();await t.wait();__session.change('active');await t.wait(180);
   t.assert(t.model().paused&&!t.model().audible,'manual UI pause during microphone must suppress recovery');
   __command('play',{},true);await t.until(()=>t.model().audible,'explicit Play after manual pause');t.assert(Math.abs(t.model().position-43)<.5,'manual pause recovery position');
 }''',
 'background_denied_then_system_play': r'''async tracks=>{
   const t=__test;await t.start(tracks);__hidden=true;__session.change('interrupted');__media.externalPause(t.audio());await t.wait();__media.next='deny';__session.change('active');await t.wait(300);
   t.assert(!t.model().audible,'autoplay denial must not claim output playing');t.assert(navigator.mediaSession.playbackState==='paused','Control Center must show Play after denied recovery');const plays=t.model().plays;await t.wait(300);t.assert(t.model().plays===plays,'no autoplay retry loop');
   __command('play',{},true);await t.until(()=>t.model().audible,'explicit system Play after denied background recovery');t.assert(Math.abs(t.model().position-43)<.5,'denial recovery position');
 }''',
 'play_promise_before_metadata_and_playing': r'''async tracks=>{
   const t=__test;await t.start(tracks);__session.change('interrupted');__media.externalPause(t.audio());await t.wait();t.model().metadataDelay=150;t.model().playingDelay=60;__media.options={metadataDelay:150,playingDelay:60};__media.next='promise-only';
   __session.change('active');await t.wait(30);
   t.assert(document.getElementById('playButton').getAttribute('aria-label')==='Воспроизвести','play() promise resolving before metadata/playing must not mark UI playing');
   await t.until(()=>t.model().audible,'delayed actual playing event');t.assert(Math.abs(t.model().position-43)<.5,'metadata listener must remain alive after early play promise resolution');
 }''',
 'late_playing_event_after_manual_pause': r'''async tracks=>{
   const t=__test;await t.start(tracks);t.pausePlayback();await t.wait();__media.next='hold';window.__old=t.resumePlayback(true);await t.wait(20);t.pausePlayback();await t.wait();
   __media.event(t.audio(),'playing');await t.wait(100);
   t.assert(t.model().paused&&!t.model().audible,'late playing event cannot undo Pause');t.assert(document.getElementById('playButton').getAttribute('aria-label')==='Воспроизвести','late event cannot set UI playing');
 }''',
 'pending_play_cancelled_by_next': r'''async tracks=>{
   const t=__test;await t.start(tracks);t.pausePlayback();await t.wait();__media.next='hold';window.__old=t.resumePlayback(true);await t.wait(15);await t.playTrack(tracks[1],tracks);await t.until(()=>t.model().audible,'Next track starts');await t.wait(100);
   t.assert(t.state.currentTrack.id===2&&t.model().source.endsWith('test-B.wav'),'late AbortError from old play cannot replace Next source');
   t.assert(t.model().position<.5,'old metadata callback cannot apply 43s to Next track');
 }''',
 'pending_source_refresh_cancelled_by_next': r'''async tracks=>{
   const t=__test;await t.start(tracks);t.pausePlayback();await t.wait();__media.next='expire';window.__old=t.resumePlayback(true);await t.wait(30);await t.playTrack(tracks[1],tracks);await t.until(()=>t.model().audible,'Next while source refresh in flight');const loads=t.model().loads;await t.wait(250);
   t.assert(t.state.currentTrack.id===2&&t.model().source.endsWith('test-B.wav'),'late URL refresh cannot restore previous source');t.assert(t.model().loads===loads&&t.model().position<.5,'late refresh cannot reload or seek Next track');
 }''',
 'replacement_element_keeps_handlers': r'''async tracks=>{
   const t=__test;await t.start(tracks);__media.freeze(t.audio());const old=t.audio();__command('play',{},true);
   await t.until(()=>t.audio()!==old,'silent/stalled element must be replaced by bounded recovery',4200);
   await t.until(()=>t.model().audible,'replacement element starts');t.assert(Math.abs(t.model().position-43)<.5,'replacement restores checkpoint');
   const plays=t.model().plays;__command('pause',{},true);await t.wait(320);t.assert(t.model().paused,'replacement retains pause command handler');
   __command('play',{},true);await t.until(()=>t.model().audible,'replacement retains play command handler');__command('nexttrack',{},true);await t.until(()=>t.state.currentTrack.id===2&&t.model().audible,'replacement retains Next handler');
 }''',
 'pending_fresh_candidate_cancelled_by_next': r'''async tracks=>{
   const t=__test;await t.start(tracks);const old=t.audio();__media.freeze(old);__media.options={metadataDelay:200};__command('play',{},true);
   await t.until(()=>t.audio()!==old,'fresh candidate created',2200);const candidate=t.audio();await t.playTrack(tracks[1],tracks);await t.until(()=>t.model().audible,'Next plays after fresh candidate cancellation');__media.event(candidate,'playing');__media.advance(candidate,150);await t.wait(80);
   t.assert(t.audio().isConnected&&t.audio().id==='audio','Next keeps a valid current audio element in the DOM');t.assert(t.state.currentTrack.id===2&&t.model().source.endsWith('test-B.wav'),'stale fresh cleanup cannot restore old source');t.assert(t.model().position<.5,'Next starts at0 and ignores stale candidate events');
 }''',
 'pending_fresh_candidate_cancelled_by_pause': r'''async tracks=>{
   const t=__test;await t.start(tracks);const old=t.audio();__media.freeze(old);__media.options={metadataDelay:200};__command('play',{},true);
   await t.until(()=>t.audio()!==old,'fresh candidate created',2200);t.pausePlayback();await t.wait(300);t.assert(t.model().paused&&!t.model().audible,'fresh cleanup must respect Pause');
   __command('play',{},true);await t.until(()=>t.model().audible,'Play after cancelled fresh candidate');t.assert(Math.abs(t.model().position-43)<.5,'Pause cancelling fresh candidate must retain original43s checkpoint');
 }''',
 'new_capture_cancels_pending_fresh_candidate': r'''async tracks=>{
   const t=__test;await t.start(tracks);const old=t.audio();__media.freeze(old);__media.options={metadataDelay:200};__command('play',{},true);
   await t.until(()=>t.audio()!==old,'fresh candidate created',2200);const candidate=t.audio();__session.change('interrupted');await t.wait(40);__media.event(candidate,'playing');__media.advance(candidate,150);await t.wait();
   t.assert(t.audio()!==candidate,'new capture cancels fresh candidate ownership');t.assert(document.getElementById('currentTime').textContent==='0:43','stale candidate events cannot drift interruption checkpoint');
   __session.change('active');await t.until(()=>t.model().audible,'recovery after new capture',2200);t.assert(Math.abs(t.model().position-43)<.5,'new capture retains original checkpoint');
 }''',
 'source_refresh_timeout_then_explicit_play': r'''async tracks=>{
   const t=__test;const delayed=tracks.map(track=>({...track}));delayed[0].id=777;await t.start(delayed);t.pausePlayback();await t.wait();__media.next='expire';
   const success=await t.resumePlayback(true);t.assert(success===false,'source refresh timeout must report failure');t.assert(document.getElementById('playButton').getAttribute('aria-label')==='Воспроизвести','timeout leaves actionable Play');
   __command('play',{},true);await t.until(()=>t.model().audible,'explicit Play after URL fetch timeout');t.assert(Math.abs(t.model().position-43)<.5,'fetch timeout does not lose checkpoint');
 }''',
 'watchdog_two_stalls_are_bounded': r'''async tracks=>{
   const t=__test;await t.start(tracks);const old=t.audio();__media.freeze(old);window.dispatchEvent(new Event('focus'));
   await t.until(()=>t.audio()!==old&&t.model().audible,'first watchdog repair creates healthy replacement',2400);const repaired=t.audio();__media.freeze(repaired);await t.wait(1800);
   t.assert(t.audio()===repaired&&!t.model().audible,'second consecutive stall must stop bounded automatic repair');t.assert(document.getElementById('playButton').getAttribute('aria-label')==='Воспроизвести','bounded stall gives explicit Play');
   __command('play',{},true);await t.until(()=>t.model().audible,'explicit Play after bounded stalls',1400);t.assert(Math.abs(t.model().position-43)<.5,'watchdog failure keeps checkpoint');
 }''',
 'remote_seek_and_previous_handlers': r'''async tracks=>{
   const t=__test;await t.start(tracks);__command('seekto',{seekTime:80},true);await t.wait();t.assert(Math.abs(t.model().position-80)<.5,'remote seekto moves to80');
   __command('seekbackward',{seekOffset:10},true);await t.wait();t.assert(Math.abs(t.model().position-70)<.5,'remote seekbackward subtracts10');
   __command('seekforward',{seekOffset:5},true);await t.wait();t.assert(Math.abs(t.model().position-75)<.5,'remote seekforward adds5');t.assert(Math.abs(__positions.at(-1).position-75)<.5,'remote seeking updates MediaSession position state');
   __command('nexttrack',{},true);await t.until(()=>t.state.currentTrack.id===2&&t.model().audible,'Next command startsB');__command('previoustrack',{},true);await t.until(()=>t.state.currentTrack.id===1&&t.model().audible,'Previous command returnsA');
 }''',
}

def wav_bytes():
    buf=io.BytesIO()
    with wave.open(buf,'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000)
        sample=b''.join(int(6000*math.sin(2*math.pi*220*i/8000)).to_bytes(2,'little',signed=True) for i in range(8000))
        w.writeframes(sample*180)
    return buf.getvalue()

async def install(page,strict=True):
    await page.add_init_script(SESSION)
    async def api(route):
        url=route.request.url
        if '/api/tracks/' in url:
            await asyncio.sleep(1.4 if '/api/tracks/1/777' in url else .12)
            data={'ok':True,'result':{'track':dict(TRACKS[0],fileUrl=TRACKS[0]['fileUrl']+'?fresh')}}
        elif '/health' in url:data={'ok':True,'hasCookieP':True,'hasRemixSid':True}
        else:data={'ok':True,'result':{'tracks':[],'albums':[],'sections':[],'suggestions':[]}}
        try:await route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
        except Exception as error:
            if 'closed' not in str(error):raise
    await page.route('**/api/**',api)
    if strict:
        script=STRICT_MEDIA+(ROOT/'music/app.js').read_text()
    else:
        script=(ROOT/'music/app.js').read_text()
    # Accelerate deterministic mocks only. Native decoding must keep the real
    # grace period, particularly while the UI is decoding animated images.
    if strict:script=script.replace(', 8000)', ', 350)').replace(', 10000)', ', 800)')
    script+='\nwindow.__test={state,resumePlayback,pausePlayback,playTrack,elements,agePendingPause:()=>{pendingMediaPause.started-=5000;pendingMediaPause.deadline-=5000}};\n'
    if strict:script+=COMMON
    await page.route('**/music/app.js*',lambda route:route.fulfill(status=200,content_type='text/javascript',body=script))
    if not strict:
        wav=wav_bytes()
        async def serve_wav(route):
            byte_range=route.request.headers.get('range','')
            match=re.match(r'bytes=(\d+)-(\d*)',byte_range)
            if match:
                start=int(match[1]);end=min(int(match[2]) if match[2] else len(wav)-1,len(wav)-1)
                await route.fulfill(status=206,content_type='audio/wav',headers={'Accept-Ranges':'bytes','Content-Range':f'bytes {start}-{end}/{len(wav)}'},body=wav[start:end+1])
            else:await route.fulfill(status=200,content_type='audio/wav',headers={'Accept-Ranges':'bytes'},body=wav)
        await page.route('**/test-*.wav*',serve_wav)
    await page.goto(BASE,wait_until='domcontentloaded')
    await page.wait_for_function('!!window.__test')

async def native_checks(page):
    await install(page,strict=False)
    await page.evaluate('''tracks=>{
      __test.tracks=tracks;window.__nativeEvents=[];window.__nativeStage='initial-play';
      for(const type of ['loadedmetadata','playing','pause','timeupdate','seeking','seeked','abort','emptied','error'])document.addEventListener(type,event=>{if(event.target.tagName==='AUDIO')__nativeEvents.push({type,position:event.target.currentTime,ready:event.target.readyState})},true);
      const button=document.createElement('button');button.id='__nativeStart';button.textContent='Start native WAV';button.style.cssText='position:fixed;top:10px;left:10px;z-index:99999';document.body.append(button);
      button.addEventListener('click',()=>{if(!__test.state.currentTrack)void __test.playTrack(tracks[0],tracks)}, {once:true});
    }''',TRACKS)
    await page.locator('#__nativeStart').click()
    await page.wait_for_function('__test.elements.audio.currentTime>.2',timeout=5000)
    start=await page.evaluate('({position:__test.elements.audio.currentTime,paused:__test.elements.audio.paused,ready:__test.elements.audio.readyState,mediaSession:!!navigator.mediaSession,state:navigator.mediaSession?.playbackState,events:__nativeEvents})')
    await page.evaluate('__nativeStage="initial-seek";__test.elements.audio.currentTime=43')
    await page.wait_for_function('__test.elements.audio.currentTime>=43')
    await page.evaluate('window.__resumeNativeAudio=__test.elements.audio;window.__resumeNativeSource=__resumeNativeAudio.getAttribute("src");window.__resumeEventCount=__nativeEvents.length;__session.change("interrupted");__test.elements.audio.pause()')
    await page.wait_for_timeout(150)
    interrupted=await page.evaluate('({position:__test.elements.audio.currentTime,paused:__test.elements.audio.paused,ui:document.getElementById("playButton").getAttribute("aria-label")})')
    await page.evaluate('__nativeStage="native-capture-resume";__session.change("active")')
    await page.wait_for_function('!__test.elements.audio.paused&&__test.elements.audio.currentTime>43.1',timeout=5000)
    resumed=await page.evaluate('({position:__test.elements.audio.currentTime,paused:__test.elements.audio.paused,volume:__test.elements.audio.volume,muted:__test.elements.audio.muted,state:navigator.mediaSession?.playbackState,sameElement:__test.elements.audio===__resumeNativeAudio,sameSource:__test.elements.audio.getAttribute("src")===__resumeNativeSource,emptiedDuringResume:__nativeEvents.slice(__resumeEventCount).some(event=>event.type==="emptied"),events:__nativeEvents.slice(-16)})')
    await page.evaluate('__command("pause",{},true)')
    await page.wait_for_timeout(320)
    cc_pause=await page.evaluate('({position:__test.elements.audio.currentTime,paused:__test.elements.audio.paused,state:navigator.mediaSession?.playbackState})')
    await page.evaluate('__nativeStage="foreground-control-play";window.__controlResumePosition=__test.elements.audio.currentTime;window.__controlResumeEventCount=__nativeEvents.length;__command("play",{},true)')
    await page.wait_for_function('!__test.elements.audio.paused&&__test.elements.audio.currentTime>__controlResumePosition+.05',timeout=5000)
    cc_play=await page.evaluate('({sameElement:__test.elements.audio===__resumeNativeAudio,sameSource:__test.elements.audio.getAttribute("src")===__resumeNativeSource,emptiedDuringResume:__nativeEvents.slice(__controlResumeEventCount).some(event=>event.type==="emptied")})')
    # Real decoder exercise for the iOS manual-background-only restart. The
    # document visibility and remote callback are simulated; WAV playback,
    # load, metadata, seek restoration and clock progression are native.
    # Move far from the original43s interruption checkpoint so ordinary clock
    # progression cannot hide a stale checkpoint reused by the decoder.
    await page.evaluate('__nativeStage="distinct-control-seek";__command("seekto",{seekTime:80},true)')
    await page.wait_for_function('!__test.elements.audio.seeking&&__test.elements.audio.currentTime>80.1',timeout=5000)
    await page.evaluate('__hidden=true;__test.elements.audio.playbackRate=1.25;__command("pause",{},true)')
    await page.wait_for_timeout(320)
    await page.evaluate('__nativeStage="hidden-control-restart";window.__hiddenRestartPosition=__test.elements.audio.currentTime;window.__hiddenRestartRate=__test.elements.audio.playbackRate;window.__hiddenRestartEventCount=__nativeEvents.length;__command("play",{},true)')
    await page.wait_for_function('!__test.elements.audio.paused&&__test.elements.audio.currentTime>__hiddenRestartPosition+.05',timeout=5000)
    hidden_play=await page.evaluate('({sameElement:__test.elements.audio===__resumeNativeAudio,sameSource:__test.elements.audio.getAttribute("src")===__resumeNativeSource,position:__test.elements.audio.currentTime,checkpoint:__hiddenRestartPosition,speed:__test.elements.audio.playbackRate,previousSpeed:__hiddenRestartRate,volume:__test.elements.audio.volume,muted:__test.elements.audio.muted,emptied:__nativeEvents.slice(__hiddenRestartEventCount).some(event=>event.type==="emptied"),events:__nativeEvents.slice(-16)})')
    await page.evaluate('__nativeStage="next-track";__hidden=false;__command("nexttrack",{},true)')
    await page.wait_for_function('__test.state.currentTrack.id===2&&__test.elements.audio.currentTime>.1',timeout=5000)
    checks={'played':not start['paused'] and start['position']>.2,'interruption_paused':interrupted['paused'],'resume_checkpoint':43<=resumed['position']<44,'full_element_volume':resumed['volume']==1 and not resumed['muted'],'native_resume_keeps_decoder':resumed['sameElement'] and resumed['sameSource'] and not resumed['emptiedDuringResume'],'system_pause':cc_pause['paused'],'system_play_keeps_decoder':cc_play['sameElement'] and cc_play['sameSource'] and not cc_play['emptiedDuringResume'],'hidden_manual_play_reloads_same_element':hidden_play['sameElement'] and hidden_play['sameSource'] and hidden_play['emptied'] and hidden_play['checkpoint']<=hidden_play['position']<hidden_play['checkpoint']+1 and hidden_play['speed']==hidden_play['previousSpeed'] and hidden_play['volume']==1 and not hidden_play['muted']}
    return {'start':start,'interrupted':interrupted,'resumed':resumed,'control_center_handler_pause':cc_pause,'control_center_handler_play':cc_play,'hidden_control_center_restart':hidden_play,'checks':checks,'nativeAudio':True,'audioSession':'simulated','systemControlCenter':'handler invocation, not physical iOS','audibleOutput':'not measured; HTMLAudioElement events/time progression only'}

async def main(engines, case_patterns):
    results=[]
    def selected(name):
        return not case_patterns or any(fnmatch.fnmatchcase(name, pattern) for pattern in case_patterns)
    if not any(selected(name) for name in [*SCENARIOS, 'native_wav_playback']):
        raise ValueError('No test cases match the requested patterns')
    async with async_playwright() as p:
        for engine in engines:
            launch={'headless':True}
            if engine=='chromium':
                launch['args']=['--no-sandbox','--autoplay-policy=no-user-gesture-required']
                if CHROMIUM_EXECUTABLE:launch['executable_path']=CHROMIUM_EXECUTABLE
            browser=await getattr(p,engine).launch(**launch)
            for name,scenario in SCENARIOS.items():
                if not selected(name):continue
                ctx=await browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,user_agent=UA,service_workers='block')
                page=await ctx.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                result={'engine':engine,'scenario':name}
                try:
                    await install(page)
                    await page.evaluate(scenario,TRACKS)
                    result.update(passed=True,pageErrors=errors)
                    if errors:result.update(passed=False,error='unexpected pageerrors')
                except Exception as error:
                    result.update(passed=False,error=str(error).split('\n')[0])
                    try:result['snapshot']=await page.evaluate('({media:__media.snapshot(__test.audio()),ui:document.getElementById("playButton").getAttribute("aria-label"),track:__test.state.currentTrack?.id})')
                    except Exception:pass
                results.append(result);print(json.dumps(result,ensure_ascii=False),flush=True)
                await ctx.close()
            if selected('native_wav_playback'):
                ctx=await browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True,user_agent=UA,service_workers='block')
                page=await ctx.new_page()
                try:
                    observations=await native_checks(page)
                    results.append({'engine':engine,'scenario':'native_wav_playback','passed':all(observations['checks'].values()),'observations':observations})
                except Exception as error:
                    result={'engine':engine,'scenario':'native_wav_playback','passed':False,'error':str(error).split('\n')[0]}
                    try:
                        result['snapshot']=await page.evaluate('({stage:__nativeStage,position:__test.elements.audio.currentTime,duration:__test.elements.audio.duration,paused:__test.elements.audio.paused,seeking:__test.elements.audio.seeking,ready:__test.elements.audio.readyState,errorCode:__test.elements.audio.error?.code||null,events:__nativeEvents.slice(-30),diagnostics:JSON.parse(getMusicPlaybackDiagnostics()).events.slice(-20)})')
                    except Exception:pass
                    results.append(result)
                print(json.dumps(results[-1],ensure_ascii=False),flush=True)
                await ctx.close()
            await browser.close()
    REPORT.parent.mkdir(parents=True,exist_ok=True)
    REPORT.write_text(json.dumps(results,ensure_ascii=False,indent=2))
    print(f'{sum(r["passed"] for r in results)}/{len(results)} checks passed; results: {REPORT}',flush=True)
    return bool(results) and all(result['passed'] for result in results)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Music interruption recovery regression checks with strict media fixtures and native WAV playback.')
    parser.add_argument('--engines',default=os.getenv('PASHAMUSIC_TEST_ENGINES','webkit,chromium'),help='Comma-separated webkit/chromium engines')
    parser.add_argument('--cases',default=os.getenv('PASHAMUSIC_TEST_CASES',''),help='Comma-separated case names or glob patterns, e.g. pending* or native_wav_playback')
    parser.add_argument('--list-cases',action='store_true',help='List available test cases without launching a browser')
    args=parser.parse_args()
    if args.list_cases:
        print('\n'.join([*SCENARIOS,'native_wav_playback']))
        sys.exit(0)
    engines=[engine.strip() for engine in args.engines.split(',') if engine.strip()]
    if not engines or any(engine not in ('webkit','chromium') for engine in engines):parser.error('Engines must be webkit and/or chromium')
    patterns=[pattern.strip() for pattern in args.cases.split(',') if pattern.strip()]
    sys.exit(0 if asyncio.run(main(engines,patterns)) else 1)
