# iOS HLS comparison

Open `/music/audio-check/` in Safari or install its separate Audio Check manifest
on the Home Screen. This page does not import the application's playback code.
The main application's Settings also links here, allowing the experiment to run
inside its existing standalone context with its saved connection settings. A
separately installed Audio Check may have separate storage on iOS; if library
credentials are unavailable there, use the existing app's Settings link for that
source. The controlled HLS and M4A require no credentials in either context.

Sources:

- `assets/reference.m3u8`: native HLS, unencrypted AAC-LC, VOD, approximately
  six-second MPEG-TS segments, 180 seconds.
- `assets/reference.m4a`: the same AAC packets, progressive M4A, faststart.
- Current library source: fresh `/api/first-track` URL, using the existing
  connection settings on this origin. No keys or source URLs are exported.

The reference audio is an original synthesized tone sequence, generated with
FFmpeg, with no third-party recordings. HLS is remuxed from the M4A without
re-encoding. Assets are intentionally hosted on the same server for comparison.
Before testing production, verify M4A byte Range requests return 206 and playlists
and segments return 200 with appropriate MIME types. Do not infer CDN behavior
from local fixture-server headers.

Native mode installs no MediaSession handlers or playbackState setters. Session
mode installs only one direct play()/pause() per command and publishes native
playing/pause events. Both set AudioSession.type=playback once when supported.
There are no background retries, seeks, source reloads, or visibility-triggered
playback actions. Preparing a trial explicitly clears and loads the selected
source; changing the mode reloads the document. Use a fresh preparation for each
scenario, and compare at the same starting position.

The scoped service worker passes requests through without caching, isolating the
experiment from the existing application's full-response asset cache. Its scope
does not cover the main player. Preparation stays disabled until isolation is
active. A service worker is required to isolate an installed app's existing
controller; this page does not use it to keep playback alive.

Run the on-page Control Center and external-microphone scenarios for each source
in native mode first. Repeat failing comparisons in Session mode, then repeat in
installed standalone mode. Ensure other browser/player tabs are stopped. Record
whether audio actually continued before foregrounding, using the result buttons.
After short recording tests, repeat successful combinations with 60–120 seconds
of recording, then at least ten pause/play and capture cycles.

Reports retain up to six trial snapshots, each with up to 1800 events. Position
and buffer samples are recorded on changes every 500ms while JavaScript runs;
sampling gaps are explicit. Background timer suspension means reports are not a
continuous native trace. No automatic background behavior is inferred from
missing samples. A preparation increments `trial`; a page load changes `run`.
Reports persist locally and can be copied or downloaded.

Resource Timing entries for bundled assets are best-effort only. Native HLS
requests may be missing. For root-cause confirmation, synchronize a physical
iPhone sysdiagnose / Web Inspector or network capture with report timestamps:
buffer policy and purge, interruption begin/end, buffering suspend/resume,
audio-session activation, loaded ranges, HTTP segment outcomes and process state.
Redact signed URLs and credentials from external traces before sharing.

Interpretation:

- Controlled HLS fails, matching M4A succeeds: prioritize native HLS resource
  recovery; investigate progressive delivery before changing the main player.
- Only current-library HLS fails: inspect its playlists/segments, encryption,
  redirects, authorization lifetime and transport differences.
- Minimal native mode succeeds but the main player fails: isolate application
  command/state interactions; do not assume the production controller is sound.
- Both formats fail in the minimal page: inspect native activation/background
  restrictions before selecting a native playback architecture.

These are experiment directions, not guarantees. Desktop Chromium can validate
M4A loading and the diagnostic page. Linux WebKit in this workspace lacks the
needed AAC/HLS support and cannot validate iPhone AVFoundation or Control Center.

## Default category experiment

`default-session.html` never writes AudioSession.type and forces native controls
without MediaSession handlers. Its separate `default-session.webmanifest` starts
this document directly as Audio Default, avoiding an initial visit to the
playback-setting baseline. Stop other players before testing. Report version 3
records `experiment=default-audio-session`, `sessionTypePolicy=untouched`, the
initial category and observed category on every event. Do not reset the category
to auto: that would introduce a second intervention. Compare the same M4A in
standalone mode with the previous explicit-playback trial. No recovery actions
are added. Physical iPhone results are required to evaluate this hypothesis.
