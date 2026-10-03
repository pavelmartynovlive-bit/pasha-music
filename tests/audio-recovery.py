import argparse, asyncio, fnmatch, io, json, math, os, re, shutil, sys, wave
from urllib.parse import urlsplit
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(os.getenv('PASHAMUSIC_TEST_REPO', Path(__file__).resolve().parents[1]))
BASE = os.getenv('PASHAMUSIC_TEST_URL', 'http://127.0.0.1:8911/music/')
FIXTURE_ORIGIN = '{0.scheme}://{0.netloc}'.format(urlsplit(BASE))
CHROMIUM_EXECUTABLE = os.getenv('PASHAMUSIC_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('chromium-browser')
REPORT = Path(os.getenv('PASHAMUSIC_TEST_REPORT', '/tmp/pasha-audio-recovery-results.json'))
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1'
TRACKS = [{'ownerId': 1, 'id': i + 1, 'title': f'Track {n}', 'artist': f'Artist {n}', 'duration': 180, 'fileUrl': f'{FIXTURE_ORIGIN}/test-{n}.wav'} for i, n in enumerate(['A', 'B'])]

SESSION = r'''(() => {
  localStorage.setItem('pashaMusicConnectionV1', JSON.stringify({backendUrl:'http://localhost:8787',apiKey:'test-only'}));
  window.__actions = {};
  window.__gesture=false;
  Object.defineProperty(navigator,'userActivation',{configurable:true,value:{get isActive(){return __gesture},hasBeenActive:true}});
  window.__command=(name,details={},userGesture=true)=>{__gesture=userGesture;try{return __actions[name]({action:name,...details})}finally{__gesture=false}};
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
  function m(a){let v=models.get(a);if(!v){v={id:++serial,source:'',paused:true,ended:false,position:0,duration:NaN,ready:0,epoch:0,plays:0,loads:0,events:[],next:'ok',pending:[],audible:false,metadataDelay:24,playingDelay:16,...window.__media?.options};models.set(a,v)}return v}
  function event(a,name){const v=m(a);v.events.push({name,position:v.position,time:performance.now(),epoch:v.epoch});a.dispatchEvent(new Event(name))}
  function cancel(a){const v=m(a);v.epoch++;v.audible=false;v.pending.splice(0).forEach(p=>p.reject(new DOMException('Superseded media operation','AbortError')))}
  function finish(a){const v=m(a);if(v.paused||!v.ready||v.blocked||v.next==='frozen')return;const epoch=v.epoch;setTimeout(()=>{if(epoch!==v.epoch||v.paused||v.blocked)return;v.audible=true;event(a,'playing');v.pending.splice(0).forEach(p=>p.resolve());if(!v.clockTimer)v.clockTimer=setInterval(()=>{if(v.audible&&!v.paused){v.position+=.2;event(a,'timeupdate')}},200)},v.playingDelay)}
  function sourceLoad(a,source){const v=m(a);cancel(a);v.source=source;v.ready=0;v.position=0;v.duration=NaN;v.ended=false;const epoch=v.epoch;setTimeout(()=>{if(epoch!==v.epoch)return;event(a,'abort');event(a,'emptied');},0);setTimeout(()=>{if(epoch!==v.epoch)return;v.ready=1;v.duration=180;event(a,'loadedmetadata');v.ready=4;event(a,'canplay');finish(a);},v.metadataDelay)}
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
    const set=name==='src'?function(value){if(this.tagName!=='AUDIO')return old.set.call(this,value);sourceLoad(this,String(value))}:name==='currentTime'?function(value){if(this.tagName!=='AUDIO')return old.set.call(this,value);const v=m(this);if(!v.ready)throw new DOMException('No metadata','InvalidStateError');v.position=Number(value);setTimeout(()=>{event(this,'seeking');event(this,'seeked');event(this,'timeupdate')},0)}:old.set;
    Object.defineProperty(proto,name,{configurable:true,get,set});
  }
  const nativePlay=proto.play,nativePause=proto.pause,nativeLoad=proto.load;
  proto.play=function(){if(this.tagName!=='AUDIO')return nativePlay.call(this);const v=m(this);v.plays++;const mode=window.__media.next||v.next;window.__media.next=null;v.next=mode==='frozen'?'frozen':'ok';v.blocked=mode==='hold'||mode==='frozen';if(mode==='deny')return Promise.reject(new DOMException('Autoplay blocked','NotAllowedError'));if(mode==='expire')return Promise.reject(new DOMException('Bad URL','NotSupportedError'));v.paused=false;setTimeout(()=>event(this,'play'),0);if(mode==='promise-only')return Promise.resolve();return new Promise((resolve,reject)=>{v.pending.push({resolve,reject});if(mode!=='hold'&&mode!=='frozen')finish(this)})};
  proto.pause=function(){if(this.tagName!=='AUDIO')return nativePause.call(this);const v=m(this);if(v.paused)return;v.paused=true;v.audible=false;v.pending.splice(0).forEach(p=>p.reject(new DOMException('Paused pending play','AbortError')));setTimeout(()=>event(this,'pause'),0)};
  proto.load=function(){if(this.tagName!=='AUDIO')return nativeLoad.call(this);const v=m(this);v.loads++;sourceLoad(this,v.source)};
  window.__media={model:m,event,next:null,options:{},advance(a,position){const v=m(a);v.position=position;event(a,'timeupdate')},externalPause(a){a.pause()},freeze(a){const v=m(a);v.audible=false;v.next='frozen'},forcePaused(a){m(a).paused=false},snapshot(a){const v=m(a);return {id:v.id,source:v.source,paused:v.paused,position:v.position,ready:v.ready,plays:v.plays,loads:v.loads,audible:v.audible,events:v.events.slice(-12)}}};
})();'''

COMMON = r'''window.__test.assert=(condition,message)=>{if(!condition)throw Error(message)};
window.__test.wait=(ms=35)=>new Promise(resolve=>setTimeout(resolve,ms));
window.__test.until=async(check,message,timeout=2200)=>{let start=performance.now();while(!check()){if(performance.now()-start>timeout)throw Error(message);await __test.wait(15)}};
window.__test.audio=()=>__test.elements.audio;
window.__test.model=()=>__media.model(__test.audio());
window.__test.start=async(tracks)=>{await __test.playTrack(tracks[0],tracks);await __test.until(()=>__test.model().audible,'initial playing event');__media.advance(__test.audio(),43);await __test.wait()};'''

SCENARIOS = {
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
 'automatic_system_play_waits_for_microphone': r'''async tracks=>{
   const t=__test;await t.start(tracks);__command('pause',{},false);__session.change('interrupted');t.model().audible=false;await t.wait();
   const plays=t.model().plays,loads=t.model().loads;__command('play',{},false);await t.wait(80);
   t.assert(t.model().plays===plays&&t.model().loads===loads,'automatic Play must not restart decoder while microphone owns known interrupted session');
   __session.change('active');__command('play',{},false);await t.until(()=>t.model().audible,'automatic system Play resumes remembered intent');t.assert(Math.abs(t.model().position-43)<.5,'automatic Play restores checkpoint');
 }''',
 'native_auto_play_without_audio_session': r'''async tracks=>{
   const t=__test;Object.defineProperty(navigator,'audioSession',{configurable:true,value:undefined});await t.start(tracks);
   __hidden=true;document.dispatchEvent(new Event('visibilitychange'));__command('pause',{},false);__media.externalPause(t.audio());await t.wait(100);
   __hidden=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));__command('play',{},true);
   await t.until(()=>t.model().audible,'native automatic Play without AudioSession must recover');
   t.assert(Math.abs(t.model().position-43)<.5,'fallback restores checkpoint');
 }''',
 'manual_control_center_pause_stays_paused': r'''async tracks=>{
   const t=__test;await t.start(tracks);__command('pause',{},true);await t.wait(320);
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
   const t=__test;await t.start(tracks);__hidden=true;__session.change('interrupted');await t.wait();__media.next='deny';__session.change('active');await t.wait(300);
   t.assert(!t.model().audible,'autoplay denial must not claim output playing');t.assert(navigator.mediaSession.playbackState==='paused','Control Center must show Play after denied recovery');const plays=t.model().plays;await t.wait(300);t.assert(t.model().plays===plays,'no autoplay retry loop');
   __command('play',{},true);await t.until(()=>t.model().audible,'explicit system Play after denied background recovery');t.assert(Math.abs(t.model().position-43)<.5,'denial recovery position');
 }''',
 'play_promise_before_metadata_and_playing': r'''async tracks=>{
   const t=__test;await t.start(tracks);__session.change('interrupted');await t.wait();t.model().metadataDelay=150;t.model().playingDelay=60;__media.options={metadataDelay:150,playingDelay:60};__media.next='promise-only';
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
    # Test wait timeouts are shortened, not production logic/event ordering.
    script=script.replace(', 8000)', ', 350)').replace(', 10000)', ', 800)')
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
      __test.tracks=tracks;window.__nativeEvents=[];
      for(const type of ['loadedmetadata','playing','pause','timeupdate','abort','emptied','error'])document.addEventListener(type,event=>{if(event.target.tagName==='AUDIO')__nativeEvents.push({type,position:event.target.currentTime,ready:event.target.readyState})},true);
      const button=document.createElement('button');button.id='__nativeStart';button.textContent='Start native WAV';button.style.cssText='position:fixed;top:10px;left:10px;z-index:99999';document.body.append(button);
      button.addEventListener('click',()=>{if(!__test.state.currentTrack)void __test.playTrack(tracks[0],tracks)}, {once:true});
    }''',TRACKS)
    await page.locator('#__nativeStart').click()
    await page.wait_for_function('__test.elements.audio.currentTime>.2',timeout=5000)
    start=await page.evaluate('({position:__test.elements.audio.currentTime,paused:__test.elements.audio.paused,ready:__test.elements.audio.readyState,mediaSession:!!navigator.mediaSession,state:navigator.mediaSession?.playbackState,events:__nativeEvents})')
    await page.evaluate('__test.elements.audio.currentTime=43')
    await page.wait_for_function('__test.elements.audio.currentTime>=43')
    await page.evaluate('__session.change("interrupted");__test.elements.audio.pause()')
    await page.wait_for_timeout(150)
    interrupted=await page.evaluate('({position:__test.elements.audio.currentTime,paused:__test.elements.audio.paused,ui:document.getElementById("playButton").getAttribute("aria-label")})')
    await page.evaluate('__session.change("active")')
    await page.wait_for_function('!__test.elements.audio.paused&&__test.elements.audio.currentTime>43.1',timeout=5000)
    resumed=await page.evaluate('({position:__test.elements.audio.currentTime,paused:__test.elements.audio.paused,volume:__test.elements.audio.volume,muted:__test.elements.audio.muted,state:navigator.mediaSession?.playbackState,events:__nativeEvents.slice(-16)})')
    await page.evaluate('__command("pause",{},true)')
    await page.wait_for_timeout(320)
    cc_pause=await page.evaluate('({position:__test.elements.audio.currentTime,paused:__test.elements.audio.paused,state:navigator.mediaSession?.playbackState})')
    await page.evaluate('__command("play",{},true)')
    await page.wait_for_function('!__test.elements.audio.paused',timeout=5000)
    await page.evaluate('__command("nexttrack",{},true)')
    await page.wait_for_function('__test.state.currentTrack.id===2&&__test.elements.audio.currentTime>.1',timeout=5000)
    checks={'played':not start['paused'] and start['position']>.2,'interruption_paused':interrupted['paused'],'resume_checkpoint':43<=resumed['position']<44,'full_element_volume':resumed['volume']==1 and not resumed['muted'],'system_pause':cc_pause['paused']}
    return {'start':start,'interrupted':interrupted,'resumed':resumed,'control_center_handler_pause':cc_pause,'checks':checks,'nativeAudio':True,'audioSession':'simulated','systemControlCenter':'handler invocation, not physical iOS','audibleOutput':'not measured; HTMLAudioElement events/time progression only'}

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
                except Exception as error:results.append({'engine':engine,'scenario':'native_wav_playback','passed':False,'error':str(error).split('\n')[0]})
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
