const { chromium, GAME_URL, createSuite } = require("./harness");
const suite = createSuite("picker-layout");
const VPS = [[320,568],[360,640],[375,667],[390,844],[568,320],[667,375],[740,360],[812,400],[932,430],[1280,800]];
(async () => {
  const b = await chromium.launch(); const bad = [];
  for (const [w,h] of VPS) {
    const p = await b.newPage(); await p.setViewportSize({width:w,height:h});
    await p.goto(GAME_URL); await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      const row = document.querySelector('.len-row').getBoundingClientRect();
      const pills = [...document.querySelectorAll('.len')].map(e => e.getBoundingClientRect());
      const cat = document.querySelector('.cat-scroll').getBoundingClientRect();
      const play = document.querySelector('#playBtn').getBoundingClientRect();
      const label = document.querySelector('.len-label').getBoundingClientRect();
      return {
        rowVisible: row.bottom <= window.innerHeight + 1 && row.top >= 0 && row.height > 0,
        pillH: Math.round(Math.min(...pills.map(r=>r.height))),
        pillW: Math.round(Math.min(...pills.map(r=>r.width))),
        pillsOnScreen: pills.every(r => r.right <= window.innerWidth + 1 && r.left >= 0),
        labelWraps: label.height > 20,
        catScrollH: Math.round(cat.height),
        playOnScreen: play.bottom <= window.innerHeight + 1,
        noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1
      };
    });
    // one category card must still be visible so the grid is usable
    const ok = r.rowVisible && r.pillsOnScreen && r.playOnScreen && r.noHScroll &&
               r.pillH >= 36 && r.pillW >= 40 && !r.labelWraps && r.catScrollH >= 60;
    console.log(`${w}x${h}`.padEnd(10), ok?'ok  ':'FAIL', JSON.stringify(r));
    if (!ok) bad.push(`${w}x${h}`);
    await p.close();
  }
  bad.forEach((v) => suite.check(false, 'layout problem at ' + v));
  suite.check(bad.length === 0, `layout holds at all ${VPS.length} viewports`);
  await b.close();
  suite.report();
})();
