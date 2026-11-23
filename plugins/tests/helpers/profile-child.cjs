"use strict";
const fs=require("node:fs"),path=require("node:path");
const [file,action,rawContext,rawConfig]=process.argv.slice(2);
const context=JSON.parse(rawContext);let writes=0;
global.pi={app:{getLocale:async()=>"en"},session:{getActive:async()=>({sessionId:context.sessionId,projectPath:context.projectPath})},
 plugin:{getSettings:async()=>JSON.parse(fs.readFileSync(file,"utf8")),setSettings:async partial=>{const current=JSON.parse(fs.readFileSync(file,"utf8"));fs.writeFileSync(file,JSON.stringify({...current,...partial}),{mode:0o600});writes++;},getDataPath:async()=>{throw Error("Unexpected data path access");}},
 desktop:{invoke:async input=>{if(input.operation!=="project/get")throw Error("Unexpected desktop capability");return {workspace:{path:context.projectPath,remote:{hostKey:context.hostKey,path:context.root}}};}},
};
const plugin=require("../../ssh-upload/main.js");
(async()=>{try{await plugin.onLoad();if(action==="save")await plugin.onRendererCall("saveConfig",{sessionId:context.sessionId,config:JSON.parse(rawConfig)});console.log(JSON.stringify({ok:true,context:await plugin.onRendererCall("context"),writes}));}
 catch(e){console.log(JSON.stringify({ok:false,code:e.code,message:e.message,writes}));}
 finally{await plugin.onUnload();delete global.pi;}})();
