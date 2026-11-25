// Renders the intro scene frame by frame (see README.md): node capture.cjs <outdir> <w> <h> <fps> <seconds>
const {chromium}=require('playwright-core');
const fs=require('fs');
const [out,W,H,FPS,SEC]=[process.argv[2],+process.argv[3],+process.argv[4],+process.argv[5],+process.argv[6]];
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--use-gl=angle','--ignore-gpu-blocklist']});
 const p=await (await b.newContext({viewport:{width:Math.min(W,1920),height:Math.min(H,1920)}})).newPage();
 p.on('pageerror',e=>console.log('err',e.message));
 await p.goto(`http://localhost:8090/intro.html?w=${W}&h=${H}`);
 await p.waitForFunction(()=>window.__ready,null,{timeout:30000});
 const n=Math.round(FPS*SEC);
 for (let i=0;i<n;i++){
   const url=await p.evaluate((t)=>window.frameAt(t), i/FPS);
   fs.writeFileSync(`${out}/f${String(i).padStart(5,'0')}.jpg`, Buffer.from(url.split(',')[1],'base64'));
 }
 console.log('frames',n); await b.close();
})();
