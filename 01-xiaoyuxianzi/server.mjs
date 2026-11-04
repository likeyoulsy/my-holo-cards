import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ktx2':'image/ktx2','.glb':'model/gltf-binary','.mp4':'video/mp4'};
http.createServer(async(req,res)=>{try{
  // 2026-10-25：滑轨锁定持久化接口（B 方案）——POST /api/config-patch 把组级锁定的
  // 参数叶值深合并进 web/card-config.json；仅白名单顶层键，仅本机回环可达。
  // 2026-11-04 漂移根因修复 + tiltReveal 多帧守卫：
  // - 漂移根因：之前只写 web/card-config.json，根 config 永不回写 → 面板改完两套漂移。
  //   修复：写完 web 后同步回根 config（根存 init 规范，面板存用户最终值，以后 sync-web 以用户值为准）。
  // - tiltReveal 守卫：乾坤卡/单帧卡（无 subject_b/c、background_b/c、effects_b 多帧素材）禁止写 tiltReveal。
  //   依据：hasReveal 引擎逻辑 → 第 4 路 config.tiltReveal 会被 OR 进 hasReveal → 激活 reveal2() → mB 闪摆到 1 → 背景金线帧门控乘 0。
  if(req.method==='POST'&&(req.url==='/api/config-patch'||req.url.startsWith('/api/config-patch?'))){
    let body='';
    req.on('data',c=>{body+=c;if(body.length>1e5)req.destroy();});
    req.on('end',()=>{
      try{
        const patch=JSON.parse(body);
        const cfgPath=path.join(root,'card-config.json');
        const cfg=JSON.parse(readFileSync(cfgPath,'utf8'));
        // tiltReveal 多帧守卫（2026-11-04 用户规则：乾坤卡单帧无多帧素材，禁止写入 tiltReveal）
        // 多帧素材判定：subject_b/c、background_b/c、effects_b 任一存在 → 允许 tiltReveal；全不存在 → 单帧卡 → 禁止
        const assetsDir=path.join(root,'assets');
        const hasMultiFrame=['subject_b.png','subject_c.png','background_b.png','background_c.png','effects_b.png','effects_c.png']
          .some(f=>{try{return statSync(path.join(assetsDir,f)).isFile();}catch{return false;}});
        if(patch.tiltReveal!==undefined&&!hasMultiFrame){
          console.warn('[config-patch] tiltReveal 被拒：当前卡无多帧素材（单帧/乾坤卡），tiltReveal 会激活 reveal2() 干扰帧门控');
          delete patch.tiltReveal;
        }
        const ALLOWED=['parameters','autoSway','tiltReveal','back','_locked'];
        const mergeDeep=(d,s)=>{for(const k of Object.keys(s)){
          if(s[k]&&typeof s[k]==='object'&&!Array.isArray(s[k]))d[k]=mergeDeep(d[k]&&typeof d[k]==='object'&&!Array.isArray(d[k])?d[k]:{},s[k]);
          else d[k]=s[k];
        }return d;};
        let touched=0;
        for(const k of ALLOWED){
          if(patch[k]===undefined)continue;
          if(patch[k]&&typeof patch[k]==='object'&&!Array.isArray(patch[k])){
            cfg[k]=mergeDeep(cfg[k]&&typeof cfg[k]==='object'?cfg[k]:{},patch[k]);
          }else{
            cfg[k]=patch[k];
          }
          touched++;
        }
        if(!touched)throw new Error('no allowed keys in patch');
        writeFileSync(cfgPath,JSON.stringify(cfg,null,2),'utf8');
        // 漂移根因修复（2026-11-04）：同步回写根 config——根 config 是 init 规范的存放位置，
        // 面板改完用户最终值后必须同步回根，否则下次 sync-web 会从根读回旧值覆盖 web 副本
        const rootCard=path.resolve(root,'..','card-config.json');
        try{
          if(statSync(rootCard).isFile()){
            writeFileSync(rootCard,JSON.stringify(cfg,null,2),'utf8');
            console.log('[config-patch] 同步回根 config:',rootCard);
          }
        }catch(e){console.warn('[config-patch] 根 config 回写跳过（可能不存在）:',e.message);}
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end('{"ok":true}');
      }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:String(e.message||e)}));}
    });
    return;
  }
  let url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let filename=path.resolve(root,'.'+url);if(filename!==root&&!filename.startsWith(root+path.sep)){res.writeHead(403);return res.end('Forbidden');}if((await stat(filename)).isDirectory())filename=path.join(filename,'index.html');const data=await readFile(filename);res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}}).listen(port,'::',()=>console.log(`Holo Card Studio: http://127.0.0.1:${port}`));  // 2026-10-31 绑 '::' 双栈：只绑 127.0.0.1 时浏览器走 localhost(::1) 会拒连（"打不开"实锤），IPv4 经映射照常可达
