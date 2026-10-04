# One bounded audio-session category experiment

Page: `session-reset.html`. Production playback code is unchanged.

Hypothesis: after background pause the WebContent process may retain a playback
category override while the native session no longer has the corresponding state.
Reassigning the same value can be deduplicated. A genuinely different override,
followed by playback on the next task, may re-send native category state.

Evidence:

- `AudioSession::setCategoryOverride` returns early for an unchanged value:
  https://github.com/WebKit/WebKit/blob/aaa99edbf8c0cfd95b8fbac26b9ddbfb6e4fef48/Source/WebCore/platform/audio/AudioSession.cpp#L207
- WebKit report 323104 documents successful page-side ambient -> next-task
  playback recovery and a proposed stale category cache after GPU reconnection:
  https://bugs.webkit.org/show_bug.cgi?id=323104
- That report mainly concerns inaudible rendering with progressing clocks. Our
  device has a frozen media clock, so neither the mechanism nor success transfers
  automatically. Report 323022 also describes frozen unpaused elements, but its
  startup playback-type workaround is already present in our baseline:
  https://bugs.webkit.org/show_bug.cgi?id=323022

Intervention: on explicit system Play only, first call the same audio.play()
synchronously, then set audioSession.type=ambient once, then restore playback
with setTimeout(0). No additional play, load, source change, rate change, seek,
new element, polling repair or microphone-triggered recovery. UI Play and native
auto-resume remain unchanged. Explicit Pause cancels a pending category task and
restores playback without playing. Pagehide/foreground also restore a pending
category change; such fallback is logged and is not background success.

The transient ambient category can mute or suspend background output; this is
an experimentally falsifiable risk, not a guaranteed activation API. Type getter
acceptance verifies the DOM assignment only, not native AVAudioSession activation.

Device test: M4A, installed PWA, play then Home Screen for ten seconds, remote
Pause for three seconds, one remote Play, wait fifteen seconds without returning.
Record audible/silent/foreground-only and export. Repeat at least three times if
successful. Source and all control behavior match the previously failing baseline.

Confirm a useful workaround only if category-restore reason=next-task occurs
while hidden, the clock subsequently progresses continuously while hidden, the
buffer/source/position are preserved and the user confirms audible output.
If assignments restore but the clock remains frozen, reject this candidate.
If restoration happens only at foreground or is rejected, the experiment cannot
confirm native healing. Do not interpret successful setter/play promises alone
as success. If only a position jump occurs, require later advancing samples.

This experiment addresses explicit remote resume, not automatic post-microphone
resume. Only a demonstrated remote recovery would justify a separate proposal
for handling automatic interruptions. No change to the main player is authorized
by a desktop mocked API test.
