// node capture.cjs <outdir> <fps> <seconds> [t1,t2,...]
const {chromium}=require('/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright-core');
const fs=require('fs');
const [out,FPS,SEC,list]=[process.argv[2],+process.argv[3],+process.argv[4],process.argv[5]];
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const p=await (await b.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1})).newPage();
 p.on('pageerror',e=>console.log('err',e.message));
 await p.goto('http://localhost:8091/index.html');
 await p.evaluate(()=>window.__ready);
 const times = list ? list.split(',').map(Number) : Array.from({length:Math.round(FPS*SEC)},(_,i)=>i/FPS);
 for (let i=0;i<times.length;i++){
   await p.evaluate(t=>window.renderAt(t), times[i]);
   const name = list ? `t${times[i].toFixed(2)}.jpg` : `f${String(i).padStart(5,'0')}.jpg`;
   await p.screenshot({path:`${out}/${name}`, type:'jpeg', quality:92});
 }
 console.log('frames',times.length); await b.close();
})();
