const { chromium, GAME_URL, createSuite } = require("./harness");
const suite = createSuite("viewports");
const VPS = [[320,568],[360,640],[375,667],[390,844],[414,896],[430,932],[768,1024],[820,1180],
             [568,320],[667,375],[740,360],[812,400],[844,390],[932,430],[1024,768],[1280,800],[1440,900],[1920,1080]];
(async () => {
  const b = await chromium.launch(); const bad = [];
  for (const [w,h] of VPS) {
    const p = await b.newPage(); await p.setViewportSize({width:w,height:h});
    await p.goto(GAME_URL); await p.waitForTimeout(250);
    // home must not clip the play button
    const homeOk = await p.evaluate(()=>{
      const b=document.querySelector('#playBtn').getBoundingClientRect();
      return b.bottom<=window.innerHeight+1 && Math.round(b.height)>=44 &&
             document.documentElement.scrollWidth<=window.innerWidth+1;
    });
    await p.locator('#playBtn').click(); await p.waitForTimeout(250);
    // force the longest explanation in the bank for a worst case
    await p.evaluate(()=>{
      const longest = QUESTIONS.reduce((a,q)=>q.e.length>a.e.length?q:a);
      const q = state.round[state.index];
      q.text = QUESTIONS.reduce((a,x)=>x.q.length>a.q.length?x:a).q;
      q.explanation = longest.e;
      UI.renderQuestion();
    });
    await p.waitForTimeout(200);
    const ci = await p.evaluate(()=>state.round[state.index].correctIndex);
    await p.locator(`.ans[data-idx="${ci}"]`).click(); await p.waitForTimeout(1300);
    const r = await p.evaluate(()=>{
      const qa=document.querySelector('#qArea'), qb=qa.getBoundingClientRect();
      const fb=document.querySelector('#feedback').getBoundingClientRect();
      const ok=document.querySelector('.ans.correct').getBoundingClientRect();
      const nb=document.querySelector('#nextBtn').getBoundingClientRect();
      const vis=(r)=>r.top>=qb.top-1 && r.bottom<=qb.bottom+1;
      // the reveal must keep at least 36px of the correct answer on screen
      const shown = Math.min(ok.bottom, qb.bottom) - Math.max(ok.top, qb.top);
      return { fbVisible:vis(fb) || qa.scrollHeight>qa.clientHeight,
               correctVisible: shown >= Math.min(36, ok.height) - 1,
               nextOnScreen: nb.bottom<=window.innerHeight+1 && nb.top>=0,
               noHScroll: document.documentElement.scrollWidth<=window.innerWidth+1,
               clipped: qa.scrollHeight>qa.clientHeight && getComputedStyle(qa).overflowY==='visible' };
    });
    const fail = !homeOk || !r.fbVisible || !r.correctVisible || !r.nextOnScreen || !r.noHScroll || r.clipped;
    console.log(`${w}x${h}`.padEnd(10), fail?'FAIL':'ok  ', JSON.stringify({homeOk, ...r}));
    if (fail) bad.push(`${w}x${h}`);
    await p.close();
  }
  bad.forEach((v) => suite.check(false, 'layout problem at ' + v));
  suite.check(bad.length === 0, `layout holds at all ${VPS.length} viewports`);
  await b.close();
  suite.report();
})();
