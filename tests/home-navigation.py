"""Home swipes, nested rails, return state, and keyboard layout regression checks.

Touch sequences and keyboard viewport changes are simulated. This does not
replace testing native keyboard/VoiceOver behavior on an installed iPhone PWA.
"""

import asyncio
import importlib.util
import json
import os
import re
import sys
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

sys.dont_write_bytecode = True
ROOT = Path(os.getenv("PASHAMUSIC_TEST_REPO", Path(__file__).resolve().parents[1]))
OUTPUT = Path(tempfile.gettempdir())
REPORT = Path(os.getenv("PASHAMUSIC_HOME_TEST_REPORT", OUTPUT / "pasha-home-navigation-results.json"))
spec = importlib.util.spec_from_file_location("audio_fixtures", ROOT / "tests/audio-recovery.py")
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
TRACKS = [dict(fixtures.TRACKS[0], id=i + 1, title=f"Track {i + 1}") for i in range(28)]
ALBUMS = [{"ownerId": 1, "id": i + 1, "title": f"Album {i + 1}", "artist": "Artist A", "tracks": []} for i in range(10)]

INIT = r"""(() => {
  const vv=visualViewport;
  window.__vv={height:HEIGHT,width:WIDTH,offsetTop:0,offsetLeft:0,scale:1};
  for(const key of Object.keys(__vv))Object.defineProperty(vv,key,{configurable:true,get:()=>__vv[key]});
  Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
  window.__touch=(target,start,end,options={})=>{
    const ids=options.multi?[1,2]:[1];
    const points=(x,y)=>ids.map(id=>({identifier:id,target,clientX:x+id-1,clientY:y}));
    const dispatch=(name,point)=>{
      const list=points(...point),finished=name==='touchend'||name==='touchcancel';
      const event=new Event(name,{bubbles:true,cancelable:true,composed:true});
      Object.defineProperties(event,{touches:{value:finished?[]:list},targetTouches:{value:finished?[]:list},changedTouches:{value:list}});
      target.dispatchEvent(event);
    };
    dispatch('touchstart',start);dispatch('touchmove',end);
    dispatch(options.cancel?'touchcancel':'touchend',end);
  };
})();"""

SNAPSHOT = """() => ({
  searchY:searchForm.getBoundingClientRect().y,
  root:document.scrollingElement.scrollTop,
  main:mainScreen.scrollTop,
  miniY:miniPlayer.getBoundingClientRect().y
})"""


async def install(page, width, height, paintable, safe_bottom):
    await page.add_init_script(fixtures.SESSION)
    await page.add_init_script(INIT.replace("HEIGHT", str(paintable)).replace("WIDTH", str(width)))
    library = json.dumps({"likedTracks": TRACKS, "albums": ALBUMS, "playlists": []})
    await page.add_init_script(f'localStorage.setItem("pashaMusicLibraryV2",JSON.stringify({library}));')

    async def api(route):
        if "/health" in route.request.url:
            data = {"ok": True, "hasCookieP": True, "hasRemixSid": True}
        else:
            data = {"ok": True, "result": {"tracks": [], "albums": [], "sections": [], "suggestions": []}}
        await route.fulfill(status=200, content_type="application/json", body=json.dumps(data))

    await page.route("**/api/**", api)
    css = (ROOT / "styles.css").read_text()
    for inset, value in [("top", "47px" if safe_bottom else "0px"), ("bottom", f"{safe_bottom}px"), ("left", "0px"), ("right", "0px")]:
        css = re.sub(r"env\(safe-area-inset-" + inset + r"(?:,\s*[^)]+)?\)", value, css)
    css += f"\nbody{{height:{height}px !important;}}"
    await page.route("**/styles.css*", lambda route: route.fulfill(status=200, content_type="text/css", body=css))
    script = fixtures.STRICT_MEDIA + (ROOT / "music/app.js").read_text()
    script += "\nwindow.__test={state,setHomeTab,showView,goBack,playTrack,renderSearchResults};\n"
    await page.route("**/music/app.js*", lambda route: route.fulfill(status=200, content_type="text/javascript", body=script))
    await page.goto(fixtures.BASE, wait_until="domcontentloaded")
    await page.wait_for_function("!!window.__test")
    await page.wait_for_timeout(850)
    await page.locator("#searchInput").evaluate("e=>e.blur()")


async def scenario(browser, engine, width, height, paintable, safe_bottom):
    context = await browser.new_context(viewport={"width": width, "height": paintable}, screen={"width": width, "height": height}, is_mobile=True, has_touch=True, user_agent=fixtures.UA, service_workers="block")
    page = await context.new_page()
    result = {"engine": engine, "width": width, "checks": {}, "pageErrors": []}
    page.on("pageerror", lambda error: result["pageErrors"].append(str(error)))

    async def check(name, expression):
        try:
            assert await page.evaluate(expression)
            result["checks"][name] = True
        except Exception as error:
            result["checks"][name] = False
            result.setdefault("failures", []).append(f"{name}: {str(error).splitlines()[0] if str(error) else 'assertion failed'}")

    try:
        await install(page, width, height, paintable, safe_bottom)
        await check("footer_removed", "!document.querySelector('#bottomBar')")
        await check("main_fills_body", "Math.abs(mainScreen.getBoundingClientRect().height-document.body.clientHeight)<1")
        await check("swipe_left_to_library", "() => {__touch(mainScreen,[280,390],[120,390]);return __test.state.homeTab==='library'}")
        await page.wait_for_timeout(450)
        await check("settings_inside_library", "!!document.querySelector('#libraryHomeView #settingsButton')")
        await page.locator("#openSearchButton").focus()
        await page.keyboard.press("Enter")
        await check("keyboard_search_button", "__test.state.homeTab==='search'")
        await page.wait_for_timeout(250)
        await page.locator("#openLibraryButton").focus()
        await page.keyboard.press("Enter")
        await check("keyboard_library_button", "__test.state.homeTab==='library'")
        await page.wait_for_timeout(250)
        if width == 393:
            await page.locator("#openSearchButton").evaluate("e=>e.blur()")
            await page.screenshot(path=str(OUTPUT / f"pasha-library-{engine}-393.png"))
        await check("swipe_right_to_search", "() => {__touch(mainScreen,[90,390],[260,390]);return __test.state.homeTab==='search'}")
        await page.wait_for_timeout(450)
        for name, target, start, end, options in [
            ("short_drag", "mainScreen", [200, 400], [180, 402], {}),
            ("vertical_drag", "mainScreen", [200, 450], [130, 230], {}),
            ("input_drag", "searchInput", [280, 300], [100, 300], {}),
            ("multitouch", "mainScreen", [280, 400], [100, 400], {"multi": True}),
            ("cancelled_drag", "mainScreen", [280, 400], [100, 400], {"cancel": True}),
        ]:
            await check(name + "_ignored", f"() => {{__touch({target},{json.dumps(start)},{json.dumps(end)},{json.dumps(options)});return __test.state.homeTab==='search'}}")
        await page.evaluate("data=>{Object.assign(__test.state,{searchTracks:data.tracks,searchAlbums:data.albums,searchActive:true});__test.renderSearchResults()}", {"tracks": TRACKS, "albums": ALBUMS})
        for rail in ["searchResultList", "searchAlbumList"]:
            await check(rail + "_gesture_kept", f"() => {{__touch({rail},[280,400],[100,400]);return __test.state.homeTab==='search'}}")
        await page.evaluate("__test.setHomeTab('library')")
        await page.locator("#settingsButton").tap()
        await check("settings_opens", "__test.state.currentView==='settings'")
        await page.locator("#closeSetupButton").tap()
        await check("settings_back_to_library", "__test.state.currentView==='home'&&__test.state.homeTab==='library'")
        await page.wait_for_timeout(350)
        await page.evaluate("mainScreen.scrollTop=400;window.__libraryScroll=mainScreen.scrollTop;__test.setHomeTab('search');__test.setHomeTab('library')")
        await check("tab_scroll_retained", "Math.abs(mainScreen.scrollTop-__libraryScroll)<1&&__libraryScroll>0")
        await page.evaluate("mainScreen.scrollTop=0;__test.setHomeTab('search');__test.state.searchActive=false;__test.renderSearchResults()")
        await page.evaluate("tracks=>__test.playTrack(tracks[0],tracks)", fixtures.TRACKS)
        await page.wait_for_timeout(100)
        await check("mini_clearance", f"miniPlayer.getBoundingClientRect().bottom<={paintable}&&miniPlayer.getBoundingClientRect().bottom>={paintable}-55")
        await page.locator("#openPlayerButton").tap()
        await check("full_player_blocks_swipe", "() => {__touch(mainScreen,[280,390],[100,390]);return __test.state.homeTab==='search'}")
        await page.evaluate("__test.showView('album',{title:'Album',tracks:[]});__test.goBack()")
        await page.wait_for_timeout(100)
        await check("detail_back_to_player", "__test.state.currentView==='home'&&!fullPlayer.hidden")
        await page.locator("#closePlayerButton").tap()
        await page.wait_for_timeout(350)
        before = await page.evaluate(SNAPSHOT)
        await page.locator("#searchInput").tap()
        for delta in [180, 250, 330]:
            await page.evaluate("h=>{__vv.height=h;visualViewport.dispatchEvent(new Event('resize'))}", height - delta)
            await page.wait_for_timeout(90)
        await page.wait_for_timeout(700)
        after = await page.evaluate(SNAPSHOT)
        result["checks"]["keyboard_geometry_stable"] = before == after
        result["keyboard"] = {"before": before, "after": after}
        result["checks"]["no_page_errors"] = not result["pageErrors"]
    except Exception as error:
        result["fatal"] = str(error).splitlines()[0]
    finally:
        await context.close()
    return result


async def main():
    results = []
    async with async_playwright() as playwright:
        for engine in ["webkit", "chromium"]:
            options = {"headless": True}
            if engine == "chromium" and fixtures.CHROMIUM_EXECUTABLE:
                options.update(executable_path=fixtures.CHROMIUM_EXECUTABLE, args=["--no-sandbox"])
            browser = await getattr(playwright, engine).launch(**options)
            for layout in [(393, 852, 805, 34), (320, 568, 568, 0)]:
                result = await scenario(browser, engine, *layout)
                results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
            await browser.close()
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    passed = sum(sum(result["checks"].values()) for result in results)
    total = sum(len(result["checks"]) for result in results)
    print(f"{passed}/{total} checks passed; report: {REPORT}", flush=True)
    return all(not result.get("fatal") and all(result["checks"].values()) for result in results)


if __name__ == "__main__":
    sys.exit(0 if asyncio.run(main()) else 1)
