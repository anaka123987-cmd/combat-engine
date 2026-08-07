/* ===== 多维矩阵·战斗引擎 v5 ===== */
/* 同层战斗：generate静默调用 + setChatMessages追加到同层 + RP输入 + 自定义行动 + HP归零检测 */
/* v4->v5: 移除cbFill/buildBattleReport的#send_textarea写入, 改为generate+同层追加 */
(function(){
  var HOST = (function(){
    try{ if(window.top && window.top!==window) return window.top; }catch(e){}
    try{ if(window.parent && window.parent!==window) return window.parent; }catch(e){}
    return window;
  })();

  if(HOST.__combatEngineV5) return;
  HOST.__combatEngineV5 = true;
  HOST.__combatEngineV4 = true;
  HOST.__combatEngineV2 = true;
  HOST.__combatEngineV3 = true;

  /* ===== 工具函数 ===== */
  function num(v,d){ var n=parseFloat(v); return isNaN(n)?(d||0):n; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
  function getValue(data,path,def){
    if(def===undefined) def='-';
    if(!data) return def;
    try{
      var keys=String(path).split('.'), cur=data;
      for(var i=0;i<keys.length;i++){
        if(cur===null||typeof cur!=='object') return def;
        cur=cur[keys[i]];
      }
      return (cur!==undefined&&cur!==null)?cur:def;
    }catch(e){ return def; }
  }

  var ATTRS=['力量','敏捷','体质','智力','精神','魅力'];
  var WEAPON_RANGE={ 'onehand':2, 'twohand':2, 'pistol':99, 'shotgun':5, 'melee':2 };

  /* ===== 骰子引擎 ===== */
  function rollDie(faces){ if(faces<1) faces=1; return Math.floor(Math.random()*faces)+1; }
  function lookupDB(statVal){
    if(statVal>=31) return {dice:'d4',faces:4,bonus:5};
    if(statVal>=26) return {dice:'d4',faces:4,bonus:3};
    if(statVal>=21) return {dice:'d2',faces:2,bonus:3};
    if(statVal>=16) return {dice:'d2',faces:2,bonus:1};
    if(statVal>=11) return {dice:null,faces:0,bonus:1};
    return {dice:null,faces:0,bonus:0};
  }
  function evalTerm(token, unit, rolls, detail){
    token=token.trim();
    var m;
    m=token.match(/^r(?:d)?(力量|敏捷|体质|智力|精神|魅力)$/);
    if(m){
      var a=m[1]; var val=unit?(num(unit.eff?unit.eff[a]:unit.attrs[a],10)):10; if(val<1) val=1;
      var r=rollDie(val);
      rolls.push({die:'d'+val,faces:val,result:r});
      detail.push(token+'=[d'+val+'='+r+']');
      return r;
    }
    if(token==='DB'){
      var sv=unit?((unit.atkType==='magic')?num(unit.eff['智力'],10):num(unit.eff['力量'],10)):10;
      var db=lookupDB(sv); var sum=0;
      if(db.dice){ var r=rollDie(db.faces); rolls.push({die:db.dice,faces:db.faces,result:r}); sum+=r; detail.push('DB('+db.dice+'='+r+')'); }
      sum+=db.bonus; detail.push('DB+'+db.bonus);
      return sum;
    }
    m=token.match(/^(\d+)d(\d+)$/);
    if(m){ var n=parseInt(m[1],10),f=parseInt(m[2],10); var sum=0,rr=[];
      for(var i=0;i<n;i++){ var r=rollDie(f); rolls.push({die:'d'+f,faces:f,result:r}); sum+=r; rr.push(r); }
      detail.push(n+'d'+f+'=['+rr.join('+')+']'); return sum; }
    m=token.match(/^d(\d+)$/);
    if(m){ var f=parseInt(m[1],10); var r=rollDie(f); rolls.push({die:'d'+f,faces:f,result:r}); detail.push('d'+f+'='+r); return r; }
    m=token.match(/^(-?\d+)$/);
    if(m){ detail.push(m[1]); return parseInt(m[1],10); }
    return 0;
  }
  function evalExpr(s, unit){
    var rolls=[], detail=[], total=0;
    var parts=s.split('+');
    for(var i=0;i<parts.length;i++){ var p=parts[i].trim(); if(p) total+=evalTerm(p,unit,rolls,detail); }
    return {total:total, rolls:rolls, detail:detail.join(' ')};
  }
  function nebDice(expr, unit){
    var s=String(expr).trim();
    var adv=/取高/.test(s), dis=/取低/.test(s);
    s=s.replace(/取低|取高/g,'').trim();
    if(!s) s='d20';
    var r1=evalExpr(s,unit);
    var res;
    if(adv||dis){
      var r2=evalExpr(s,unit);
      if(adv){ res=r1.total>=r2.total?r1:r2; }
      else{ res=r1.total<=r2.total?r1:r2; }
      res.detail=r1.detail+' | '+r2.detail+' -> 取'+(adv?'高':'低')+'='+res.total;
    } else { res=r1; }
    var crit=false, fumble=false;
    for(var i=0;i<res.rolls.length;i++){
      if(res.rolls[i].faces>1 && res.rolls[i].result===res.rolls[i].faces) crit=true;
      if(res.rolls[i].faces>1 && res.rolls[i].result===1) fumble=true;
    }
    if(crit&&fumble) fumble=false;
    return {expr:expr, total:res.total, rolls:res.rolls, detail:res.detail, crit:crit, fumble:fumble};
  }

  /* ===== 衍生属性计算 ===== */
  function getBuffMod(unit, attr){
    var sum=0; (unit.buffs||[]).forEach(function(b){ if(b.target===attr && b.op==='+') sum+=num(b.val,0); });
    return sum;
  }
  function getBuffMult(unit, target){
    var m=1; (unit.buffs||[]).forEach(function(b){ if(b.target===target && b.op==='*') m*=num(b.val,1); });
    return m;
  }
  function calcDerived(unit){
    var eff={};
    ATTRS.forEach(function(k){ eff[k]=num(unit.attrs[k],10)+getBuffMod(unit,k); });
    unit.eff=eff;
    var d={};
    d.apMax=4+Math.floor((eff['敏捷']-10)/20); if(d.apMax<1) d.apMax=1;
    d.moveSpeed=Math.floor(eff['敏捷']/5);
    d.physDef=Math.floor(eff['体质']/2)+num(unit.equipBonus&&unit.equipBonus.physDef,0);
    d.mystDef=Math.floor(eff['精神']/2)+num(unit.equipBonus&&unit.equipBonus.mystDef,0);
    d.critRate=5+num(unit.equipBonus&&unit.equipBonus.crit,0);
    d.energyMax=Math.floor((num(eff['精神'],10)+num(unit.equipBonus&&unit.equipBonus.energy,0))*getBuffMult(unit,'能量值最大'));
    if(d.energyMax<1) d.energyMax=1;
    d.hpMax=num(unit.hpMaxBase,d.energyMax);
    if(d.hpMax<1) d.hpMax=1;
    if(unit.hp==null||unit.hp<0) unit.hp=d.hpMax;
    if(unit.hp>d.hpMax) unit.hp=d.hpMax;
    if(unit.energy==null||unit.energy<0) unit.energy=d.energyMax;
    if(unit.energy>d.energyMax) unit.energy=d.energyMax;
    unit.derived=d;
  }

  /* ===== 距离计算 ===== */
  function distance(a, b){
    var dx=num(a.x,0)-num(b.x,0), dy=num(a.y,0)-num(b.y,0);
    return Math.round(Math.sqrt(dx*dx+dy*dy));
  }
  function inRange(attacker, target, weaponType){
    var d=distance(attacker,target);
    var range=WEAPON_RANGE[weaponType||'melee']||2;
    return d<=range;
  }
  function unitsInAOE(origin, radius, units){
    var hit=[];
    units.forEach(function(u){
      if(u.hp<=0) return;
      if(distance(origin,u)<=radius) hit.push(u);
    });
    return hit;
  }

  /* ===== stat_data 读取 ===== */
  function fetchStatData(){
    try{
      if(typeof getChatMessages==='function'){
        var msgs=getChatMessages('0-{{lastMessageId}}');
        if(msgs&&msgs.length){
          for(var i=msgs.length-1;i>=0;i--){
            var m=msgs[i];
            var d=(m&&m.data&&m.data.stat_data)||(m&&m.stat_data);
            if(d) return d;
          }
        }
      }
    }catch(e){}
    return null;
  }

  /* ===== 聊天变量读写 ===== */
  function getCombatState(){
    try{
      if(typeof getVariables==='function'){
        var v=getVariables({type:'chat'});
        if(v && v.combat_state) return v.combat_state;
      }
    }catch(e){}
    return null;
  }
  function saveCombatState(state){
    try{
      if(typeof insertOrAssignVariables==='function'){
        insertOrAssignVariables({combat_state:state}, {type:'chat'});
      }
    }catch(e){ console.error('[战斗引擎v5] 保存状态失败',e); }
  }
  function clearCombatState(){
    try{
      if(typeof insertOrAssignVariables==='function'){
        insertOrAssignVariables({combat_state:null}, {type:'chat'});
      }
    }catch(e){}
  }

  /* ===== 单位创建 ===== */
  function seedPlayer(data){
    return {
      id:'player', name:getValue(data,'主页.代号','')||getValue(data,'主页.姓名','玩家'),
      isPlayer:true,
      attrs:{
        '力量':getValue(data,'个人档案.战斗属性.力量',10),
        '敏捷':getValue(data,'个人档案.战斗属性.敏捷',10),
        '体质':getValue(data,'个人档案.战斗属性.体质',10),
        '智力':getValue(data,'个人档案.战斗属性.智力',10),
        '精神':getValue(data,'个人档案.战斗属性.精神',10),
        '魅力':getValue(data,'个人档案.战斗属性.魅力',10)
      },
      hpMaxBase:getValue(data,'个人档案.衍生属性.生命值.最大',0),
      hp:getValue(data,'个人档案.衍生属性.生命值.当前',0),
      energy:getValue(data,'个人档案.衍生属性.能量值.当前',0),
      energyType:getValue(data,'个人档案.衍生属性.能量值.类型','能量'),
      ap:4, buffs:[], cooldowns:{},
      equipBonus:{physDef:0,mystDef:0,crit:0,energy:0},
      atkType:'phys', weaponType:'onehand',
      x:2, y:5
    };
  }
  function makeEnemy(name,hp,str,agi,con,int,spi,cha){
    return {
      id:'e'+Date.now(), name:name||'敌人', isPlayer:false,
      attrs:{'力量':str||10,'敏捷':agi||10,'体质':con||10,'智力':int||10,'精神':spi||10,'魅力':cha||10},
      hpMaxBase:hp||30, hp:hp||30, energy:0, energyType:'能量',
      ap:4, buffs:[], cooldowns:{},
      equipBonus:{physDef:0,mystDef:0,crit:0,energy:0},
      atkType:'phys', weaponType:'onehand',
      x:7, y:5
    };
  }

  /* ===== 回合tick ===== */
  function tick(state){
    state.turn++;
    state.units.forEach(function(u){
      if(u.hp<=0) return;
      Object.keys(u.cooldowns||{}).forEach(function(k){ u.cooldowns[k]--; if(u.cooldowns[k]<=0) delete u.cooldowns[k]; });
      (u.buffs||[]).forEach(function(b){ b.turns--; });
      u.buffs=(u.buffs||[]).filter(function(b){ return b.turns>0; });
      calcDerived(u);
      u.ap=u.derived.apMax;
    });
    addLog(state,'-- 回合 '+state.turn+' -- AP恢复满，冷却/buff递减 --');
  }

  function addLog(state, text, cls){
    if(!state.log) state.log=[];
    state.log.push({turn:state.turn, text:text, cls:cls||''});
    if(state.log.length>60) state.log.shift();
  }

  function costAP(unit, ap){
    unit.ap-=ap; unit.hp-=ap*5;
    if(unit.hp<0) unit.hp=0;
  }

  /* ===== v5核心：同层战报构建 ===== */
  function buildReport(state, action, rpText, phaseLabel){
    var p=state.units.find(function(u){return u.isPlayer;});
    var enemies=state.units.filter(function(u){return !u.isPlayer;});
    var buffStr=function(u){
      if(!u.buffs||!u.buffs.length) return '';
      return u.buffs.map(function(b){ return b.name+'('+b.turns+'回合)'; }).join(',');
    };
    var report='\u2550\u2550\u2550 \u56de\u5408'+state.turn+' \u00b7 '+(phaseLabel||'\u73a9\u5bb6')+' \u2550\u2550\u2550\n';
    if(rpText){
      report+='> '+rpText+'\n';
    }
    var status='\u3010\u72b6\u6001\u3011';
    if(p){
      status+='玩家'+p.name+' HP'+p.hp+'/'+p.derived.hpMax+' AP'+p.ap+'/'+p.derived.apMax+' ('+p.x+','+p.y+')';
      if(buffStr(p)) status+=' buff:'+buffStr(p);
    }
    if(enemies.length){
      status+=' | ';
      status+=enemies.map(function(e){
        var s=e.name+'HP'+e.hp+'/'+e.derived.hpMax+' ('+e.x+','+e.y+')';
        if(buffStr(e)) s+=' buff:'+buffStr(e);
        return s;
      }).join(' ');
      if(p){
        status+=' 距离'+distance(p,enemies[0])+'格';
      }
    }
    report+=status+'\n';
    if(action){
      report+=action+'\n';
    }
    return report;
  }

  function buildBattleSnapshot(state){
    var p=state.units.find(function(u){return u.isPlayer;});
    var enemies=state.units.filter(function(u){return !u.isPlayer;});
    var snap='【战场快照】回合'+state.turn+'\n';
    if(p){
      snap+='玩家: '+p.name+' HP'+p.hp+'/'+p.derived.hpMax+' AP'+p.ap+'/'+p.derived.apMax;
      snap+=' 位置('+p.x+','+p.y+')';
      if(p.buffs&&p.buffs.length){
        snap+=' buff: '+p.buffs.map(function(b){return b.name+'('+b.turns+'回合)';}).join(', ');
      }
      snap+='\n';
    }
    enemies.forEach(function(e){
      snap+=e.name+': HP'+e.hp+'/'+e.derived.hpMax+' AP'+e.ap+'/'+e.derived.apMax;
      snap+=' 位置('+e.x+','+e.y+')';
      if(e.buffs&&e.buffs.length){
        snap+=' buff: '+e.buffs.map(function(b){return b.name+'('+b.turns+'回合)';}).join(', ');
      }
      snap+='\n';
    });
    if(enemies.length&&p){
      var d=distance(p,enemies[0]);
      snap+='距离: 玩家↔'+enemies[0].name+'='+d+'格 ('+(inRange(p,enemies[0],p.weaponType)?'可攻击':'超出射程')+')\n';
    }
    return snap;
  }

  /* ===== v5核心：同层追加 ===== */
  function scrollChatToBottom(){
    try{
      var chat=HOST.document.querySelector('#chat');
      if(chat) chat.scrollTop=chat.scrollHeight;
    }catch(e){}
  }

  async function appendCombatToLayer(text){
    var state=getCombatState();
    if(!state||state.combatMessageId==null) return;
    var msgId=state.combatMessageId;
    try{
      var msgs=getChatMessages(msgId);
      if(msgs&&msgs.length){
        var msg=msgs[0];
        var newContent=(msg.message||'')+'\n\n'+text;
        if(typeof setChatMessages==='function'){
          await setChatMessages([{message_id:msgId, message:newContent}], {refresh:'none'});
        }
      }
    }catch(e){ console.error('[战斗引擎v5] 持久化战报失败',e); }
    try{
      if(typeof retrieveDisplayedMessage==='function' && typeof formatAsDisplayedMessage==='function'){
        var $mes=retrieveDisplayedMessage(msgId);
        if($mes&&$mes.length){
          var html=formatAsDisplayedMessage(text, {message_id:msgId});
          $mes.append(html);
        }
      }
    }catch(e){ console.error('[战斗引擎v5] DOM追加战报失败',e); }
    scrollChatToBottom();
  }

  /* ===== v5核心：静默调用AI ===== */
  async function callAI(report){
    var state=getCombatState();
    if(!state) throw new Error('战斗状态不存在');
    var snapshot=buildBattleSnapshot(state);
    var userInput=report+'\n\n请演绎战斗过程并给出敌方反应，在回复末尾输出<enemy_action>敌方行动者|行动类型|目标|参数</enemy_action>。不要自行计算数值。';
    if(typeof generate!=='function'){
      throw new Error('generate函数不可用，请确保酒馆助手已安装');
    }
    var reply=await generate({
      user_input:userInput,
      should_silence:true,
      max_chat_history:5,
      injects:[{
        role:'system',
        content:snapshot,
        position:'in_chat',
        depth:0,
        should_scan:true
      }]
    });
    return String(reply);
  }

  /* ===== v5核心：净化AI回复 ===== */
  function cleanAIReply(text){
    var t=String(text||'');
    t=t.replace(/<enemy_action>[\s\S]*?<\/enemy_action>/gi,'');
    t=t.replace(/<enemy_action>[\s\S]*$/gi,'');
    t=t.replace(/<update(?:variable)?>\s*[\s\S]*?<\/update(?:variable)?>/gi,'');
    t=t.replace(/<update(?:variable)?>\s*[\s\S]*$/gi,'');
    t=t.replace(/<skill_register>[\s\S]*?<\/skill_register>/gi,'');
    t=t.replace(/<skill_register>[\s\S]*$/gi,'');
    return t.trim();
  }

  /* ===== v5核心：HP归零检测 ===== */
  function checkCombatEnd(state){
    var p=state.units.find(function(u){return u.isPlayer;});
    var enemies=state.units.filter(function(u){return !u.isPlayer;});
    var playerDead=p&&p.hp<=0;
    var allEnemiesDead=enemies.length>0&&enemies.every(function(e){return e.hp<=0;});
    if(playerDead||allEnemiesDead){
      state.phase='COMBAT_END';
      state.active=false;
      var endMsg=playerDead?'玩家阵亡，战斗失败！':'所有敌人被击败，战斗胜利！';
      addLog(state,'-- '+endMsg+' --');
      appendCombatToLayer('\u2550\u2550\u2550 \u6218\u6597\u7ed3\u675f \u00b7 '+endMsg+' \u2550\u2550\u2550');
      saveCombatState(state);
      renderAllPanels();
      return true;
    }
    return false;
  }

  /* ===== v5核心：执行玩家行动（同层闭环） ===== */
  async function executePlayerAction(state, report){
    state.phase='AI_GENERATING';
    saveCombatState(state);
    renderAllPanels();
    try{
      await appendCombatToLayer(report);
    }catch(e){ console.error('[战斗引擎v5] 追加战报失败',e); }
    if(checkCombatEnd(state)) return;
    var reply;
    try{
      reply=await callAI(report);
    }catch(e){
      addLog(state,'AI调用失败: '+(e&&e.message||e));
      console.error('[战斗引擎v5] AI调用失败',e);
      state.phase='PLAYER_ACTING';
      saveCombatState(state);
      renderAllPanels();
      return;
    }
    await processAIReply(state, reply);
  }

  /* ===== v5核心：处理AI回复（净化+敌方结算+追加） ===== */
  async function processAIReply(state, reply){
    var actions=parseEnemyAction(reply);
    var cleanText=cleanAIReply(reply);
    if(cleanText){
      try{ await appendCombatToLayer(cleanText); }catch(e){ console.error(e); }
    }
    if(checkCombatEnd(state)) return;
    if(actions.length>0){
      state.phase='ENEMY_RESOLVING';
      saveCombatState(state);
      renderAllPanels();
      var reports=[];
      actions.forEach(function(ea){
        var r=resolveEnemyAction(state, ea);
        if(r) reports.push(r);
      });
      if(reports.length){
        var enemyReport=buildReport(state, '\u3010\u654c\u65b9\u6295\u70b9\u3011\n'+reports.join('\n---\n'), '', '敌方');
        addLog(state,'【敌方行动结算】\n'+reports.join('\n'));
        try{ await appendCombatToLayer(enemyReport); }catch(e){ console.error(e); }
      }
    }
    if(checkCombatEnd(state)) return;
    tick(state);
    state.phase='PLAYER_ACTING';
    saveCombatState(state);
    renderAllPanels();
  }

  /* ===== v5核心：自定义行动 ===== */
  function doCustomAction(state, rpText, rollType){
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p) return;
    var action='';
    if(rollType&&rollType!=='none'&&rollType!==''){
      if(p) calcDerived(p);
      var r=nebDice(rollType, p||null);
      action='自由投骰: '+rollType+'\n'+r.detail+' = '+r.total+(r.crit?' [大成功]':'')+(r.fumble?' [大失败]':'');
    }
    var report=buildReport(state, action, rpText, '自定义行动');
    addLog(state,report);
    executePlayerAction(state, report);
  }

  /* ===== v5核心：QR召唤战斗会话 ===== */
  async function startCombatSession(enemyName, enemyHp, enemyStr, enemyAgi, enemyCon){
    var d=fetchStatData();
    var state={
      turn:1, units:[], log:[], phase:'PLAYER_ACTING', active:true,
      targetIdx:1, combatMessageId:null
    };
    if(d){
      var p=seedPlayer(d);
      calcDerived(p);
      state.units.push(p);
    }else{
      var p2=makeEnemy('玩家',40,12,12,12,12,12,12);
      p2.isPlayer=true; p2.id='player';
      calcDerived(p2);
      state.units.push(p2);
    }
    var enemy=makeEnemy(enemyName||'哥布林', enemyHp||30, enemyStr||12, enemyAgi||14, enemyCon||10, 8, 8, 8);
    calcDerived(enemy);
    state.units.push(enemy);
    addLog(state,'-- 战斗开始 · 回合1 --');
    saveCombatState(state);
    var initReport=buildReport(state, '战斗开始！'+state.units.map(function(u){return u.name+' HP'+u.hp+'/'+u.derived.hpMax;}).join(' vs '), '', '战斗开始');
    var msgContent='<CombatHud/>\n\n'+initReport;
    try{
      if(typeof createChatMessages==='function'){
        await createChatMessages([{role:'assistant', message:msgContent}], {refresh:'affected'});
      }
    }catch(e){ console.error('[战斗引擎v5] 创建战斗消息层失败',e); }
    try{
      if(typeof getLastMessageId==='function'){
        state.combatMessageId=getLastMessageId();
      }
    }catch(e){}
    saveCombatState(state);
  }

  /* ===== 行动结算 ===== */
  function doPlayerAttack(state, targetIdx, isAOE, aoeRadius, rpText){
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p||p.hp<=0) return;
    var apCost=(p.weaponType==='twohand')?3:2;
    if(p.ap<apCost){ addLog(state,'AP不足（需'+apCost+'）'); return; }

    if(isAOE){
      var targets=unitsInAOE(p, num(aoeRadius,2), state.units.filter(function(u){return !u.isPlayer;}));
      if(!targets.length){ addLog(state,'AOE范围内无目标'); return; }
      var allResults=[];
      targets.forEach(function(def){
        var r=resolveAttack(p,def,state);
        if(r) allResults.push(r.summary);
      });
      var hitExpr=(p.atkType==='magic')?'r智力':'r力量';
      var hit=nebDice(hitExpr,p);
      var actionStr='AOE攻击 命中'+hitExpr+'='+hit.total+(hit.crit?'(大成功)':'')+(hit.fumble?'(大失败)':'')+'\n';
      allResults.forEach(function(s){ actionStr+=s+'\n'; });
      costAP(p, apCost);
      actionStr+='消耗'+apCost+'AP/'+(apCost*5)+'HP(耐力)';
      var report=buildReport(state, actionStr, rpText, 'AOE攻击');
      addLog(state,report);
      executePlayerAction(state, report);
      return;
    }

    var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer;});
    if(!def||def.hp<=0){ addLog(state,'无有效目标'); return; }
    if(!inRange(p,def,p.weaponType)){ addLog(state,'目标超出射程！距离='+distance(p,def)+'格'); return; }

    var r=resolveAttack(p,def,state);
    costAP(p, apCost);
    var actionStr=r.summary+'\n消耗'+apCost+'AP/'+(apCost*5)+'HP(耐力) | AP->'+p.ap;
    var report=buildReport(state, actionStr, rpText, (p.atkType==='magic'?'法术攻击':'物理攻击'));
    addLog(state,report);
    executePlayerAction(state, report);
  }

  function resolveAttack(att, def, state){
    var type=att.atkType||'phys';
    var hitExpr=(type==='magic')?'r智力':'r力量';
    var hit=nebDice(hitExpr, att);
    var dodge=nebDice('rd敏捷', def);
    var hitSuccess=hit.total>dodge.total;
    var dmgExpr='d4+DB';
    var dmg=hitSuccess?nebDice(dmgExpr, att):null;
    var dmgDealt=0, hpBefore=def.hp;
    if(hitSuccess&&dmg){
      dmgDealt=dmg.total;
      if(dmg.crit||hit.crit){ dmgDealt=dmg.total*2; }
      def.hp-=dmgDealt; if(def.hp<0) def.hp=0;
    }
    var summary=att.name+'('+type+') -> '+def.name+'\n'+
      '命中 '+hit.detail+'='+hit.total+(hit.crit?' [大成功]':'')+(hit.fumble?' [大失败]':'')+'\n'+
      '闪避 '+dodge.detail+'='+dodge.total+(dodge.fumble?' [大失败]':'')+'\n'+
      '-> '+(hitSuccess?'命中':'未命中');
    if(hitSuccess&&dmg){
      summary+='\n伤害 '+dmg.detail+'='+dmg.total+(dmg.crit?' [大成功·翻倍='+dmgDealt+']':'')+'\n'+
        def.name+' HP '+hpBefore+'->'+def.hp;
    }
    return {summary:summary, hit:hit, dodge:dodge, dmg:dmg, dmgDealt:dmgDealt, hitSuccess:hitSuccess, target:def};
  }

  function doDodge(state, rpText){
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p||p.ap<1){ addLog(state,'AP不足（需1）'); return; }
    var r=nebDice('rd敏捷',p);
    costAP(p,1);
    var action='玩家闪避 '+r.detail+'='+r.total+(r.crit?' [大成功]':'')+(r.fumble?' [大失败]':'')+
      '\n消耗1AP/5HP(耐力) | AP->'+p.ap;
    var report=buildReport(state, action, rpText, '闪避');
    addLog(state,report);
    executePlayerAction(state, report);
  }

  function doParry(state, ptype, rpText){
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p||p.ap<1){ addLog(state,'AP不足（需1）'); return; }
    var base=Math.floor((num(p.eff['力量'],10)+num(p.eff['敏捷'],10))/2);
    var r=rollDie(base);
    var crit=(r===base&&base>1), fumble=(r===1&&base>1);
    var threshold={weapon:5,shield2h:5,shield1h:8,barehand:8}[ptype]||5;
    var reduceRate={weapon:0,shield2h:0.4,shield1h:0.2,barehand:0.2}[ptype]||0;
    var label={weapon:'武器格挡',shield2h:'双手盾格挡',shield1h:'单手盾格挡',barehand:'空手格挡'}[ptype]||'格挡';
    costAP(p,1);
    var action='玩家'+label+' [d'+base+'='+r+']'+(crit?' [大成功]':'')+(fumble?' [大失败]':'')+
      '\n阈值: 格挡值>命中'+threshold+'点->完全格挡；否则减伤'+(reduceRate*100)+'%'+
      (ptype==='barehand'?'\n注: 空手格挡不能挡法术':'')+
      '\n消耗1AP/5HP(耐力) | AP->'+p.ap;
    var report=buildReport(state, action, rpText, label);
    addLog(state,report);
    executePlayerAction(state, report);
  }

  function doMove(state, mode, rpText){
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p) return;
    var apCost=(mode==='run')?2:1;
    if(p.ap<apCost){ addLog(state,'AP不足（需'+apCost+'）'); return; }
    var spd=Math.floor(num(p.eff['敏捷'],10)/5);
    var dist=(mode==='run')?spd*3:spd;
    if(mode==='run'){ p.hp-=40; if(p.hp<0) p.hp=0; }
    costAP(p, apCost);
    var label=(mode==='run')?'跑步':'走路';
    var action='玩家'+label+' 移动'+dist+'米'+(mode==='run'?' (额外消耗40HP)':'')+
      '\n消耗'+apCost+'AP/'+((apCost*5)+(mode==='run'?40:0))+'HP(耐力) | AP->'+p.ap;
    var report=buildReport(state, action, rpText, label);
    addLog(state,report);
    executePlayerAction(state, report);
  }

  function doFreeRoll(state, expr, rpText){
    var p=state.units.find(function(u){return u.isPlayer;});
    if(p) calcDerived(p);
    var r=nebDice(expr, p||null);
    var action='自由投骰: '+expr+'\n'+r.detail+' = '+r.total+(r.crit?' [大成功]':'')+(r.fumble?' [大失败]':'');
    var report=buildReport(state, action, rpText, '自由投骰');
    addLog(state,report);
    appendCombatToLayer(report);
    renderAllPanels();
  }

  function addBuff(state, unitIdx, name, turns, target, op, val){
    var u=state.units[unitIdx]; if(!u) return;
    if(!u.buffs) u.buffs=[];
    u.buffs.push({name:name,turns:turns,target:target,op:op,val:val});
    calcDerived(u);
    addLog(state, u.name+'获得「'+name+'」('+turns+'回合)'+(target?(' '+op+val+' '+target):''));
    saveCombatState(state);
  }
  function removeBuff(state, unitIdx, buffIdx){
    var u=state.units[unitIdx]; if(!u||!u.buffs) return;
    u.buffs.splice(buffIdx,1); calcDerived(u);
    saveCombatState(state);
  }
  function adjustHP(state, unitIdx, delta){
    var u=state.units[unitIdx]; if(!u) return;
    u.hp=clamp(u.hp+delta,0,u.derived.hpMax);
    if(u.hp<=0) addLog(state, u.name+' HP归零！');
    saveCombatState(state);
  }

  /* ===== 技能配置表 ===== */
  function getSkillKey(){
    try{
      var ctx=(typeof getContext==='function')?getContext():{};
      var id=ctx.characterId||ctx.chatId||(ctx.name2||'')||'default';
      return 'neb_skills_'+String(id).replace(/[^a-zA-Z0-9_-]/g,'_');
    }catch(e){ return 'neb_skills_default'; }
  }
  function getSkillConfig(){
    try{ var s=localStorage.getItem(getSkillKey()); if(s) return JSON.parse(s); }catch(e){}
    return getDefaultSkills();
  }
  function saveSkillConfig(cfg){
    try{ localStorage.setItem(getSkillKey(), JSON.stringify(cfg)); }catch(e){}
  }
  function getDefaultSkills(){
    return {
      '强力一击':{name:'强力一击',type:'物理',category:'主动技能',hitBase:0,hitExpr:'r力量',apCost:3,range:2,rangeType:'melee',damage:'d6+DB',cooldown:2,aoeRadius:0,isChanting:false,isInstant:false,buffs:[],debuffs:[],desc:'集中力量进行一次强力攻击。'},
      '火球术':{name:'火球术',type:'法术',category:'主动技能',hitBase:0,hitExpr:'r智力',apCost:3,range:5,rangeType:'ranged',damage:'d6+DB',cooldown:3,aoeRadius:2,isChanting:false,isInstant:false,buffs:[],debuffs:[{name:'灼烧',turns:2,target:'',op:'+',val:'d4',desc:'每回合受到d4伤害'}],desc:'发射火球造成范围伤害并附加灼烧。'},
      '治愈术':{name:'治愈术',type:'法术',category:'主动技能',hitBase:0,hitExpr:'',apCost:3,range:0,rangeType:'self',damage:'',cooldown:2,aoeRadius:0,isChanting:false,isInstant:false,buffs:[{name:'治愈',turns:0,target:'HP',op:'+',val:'d8',desc:'恢复d8点HP'}],debuffs:[],desc:'恢复自身d8点生命值。'},
      '疾风步':{name:'疾风步',type:'辅助',category:'瞬发技能',hitBase:0,hitExpr:'',apCost:1,range:0,rangeType:'self',damage:'',cooldown:3,aoeRadius:0,isChanting:false,isInstant:true,buffs:[{name:'敏捷增幅',turns:2,target:'敏捷',op:'+',val:'10',desc:'敏捷+10持续2回合'}],debuffs:[],desc:'瞬发技能，敏捷+10持续2回合。'},
      '狙击':{name:'狙击',type:'物理',category:'主动技能',hitBase:5,hitExpr:'d20',apCost:3,range:99,rangeType:'ranged',damage:'d8+DB',cooldown:4,aoeRadius:0,isChanting:false,isInstant:false,buffs:[],debuffs:[],shootingSpec:'D',desc:'远程狙击，基础命中5+d20。'}
    };
  }

  /* ===== 射击专精 ===== */
  var SPEC_ORDER=['F','E','D','C','B','A','S','SS','SSS'];
  function parseSpec(spec){
    if(!spec) return {major:0,minor:0};
    spec=String(spec).trim().toUpperCase();
    var m=spec.match(/^([FEDCBAS]+)([+-]?)$/);
    if(!m) return {major:0,minor:0};
    var majorIdx=SPEC_ORDER.indexOf(m[1]);
    if(majorIdx<0) return {major:0,minor:0};
    var minor=(m[2]==='+')?1:(m[2]==='-')?-1:0;
    return {major:majorIdx,minor:minor};
  }
  function calcShootingBonus(spec){
    var s=parseSpec(spec);
    var bonus=0; var dice=[];
    for(var i=0;i<s.major;i++){ dice.push('d4'); bonus+=Math.floor(Math.random()*4)+1; }
    var fixedBonus=s.major*3;
    return {total:bonus+fixedBonus, diceStr:dice.length?('('+dice.join('+')+'+'+fixedBonus+')'):'(+'+fixedBonus+')', major:s.major};
  }

  /* ===== 投掷武器命中 ===== */
  function calcThrowHit(unit, difficulty){
    var str=num(unit.eff?unit.eff['力量']:unit.attrs['力量'],10);
    var halfStr=Math.floor(str/2); if(halfStr<1) halfStr=1;
    var r=Math.floor(Math.random()*halfStr)+1;
    var diff=num(difficulty,0);
    return {roll:r, halfStr:halfStr, difficulty:diff, total:r+diff, detail:'d'+halfStr+'='+r+'+'+diff};
  }

  /* ===== 双持减值 ===== */
  function dualWieldPenalty(){
    var hitPen=Math.floor(Math.random()*10)+1;
    var dmgPen=Math.floor(Math.random()*5)+1;
    return {hitPen:hitPen, dmgPen:dmgPen, hitDetail:'d10='+hitPen, dmgDetail:'d5='+dmgPen};
  }

  /* ===== 技能结算 ===== */
  function doSkill(state, skillName, targetIdx, rpText){
    var cfg=getSkillConfig();
    var skill=cfg[skillName];
    if(!skill){ return; }
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p||p.hp<=0) return;
    if(p.cooldowns&&p.cooldowns[skillName]>0){ addLog(state,'技能'+skillName+'冷却中，剩余'+p.cooldowns[skillName]+'回合'); return; }
    if(p.ap<num(skill.apCost,0)){ addLog(state,'AP不足（需要'+skill.apCost+'AP）'); return; }
    if(skill.isChanting){ if(p.ap<5){ addLog(state,'吟唱技能需要5AP'); return; } skill.apCost=5; }

    var actionStr='玩家使用技能: '+skillName+'\n';
    var isSelf=(skill.rangeType==='self');
    var targets=[];
    var aoeRadius=num(skill.aoeRadius,0);

    if(isSelf){ targets=[p]; }
    else{
      var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer&&u.hp>0;});
      if(!def){ addLog(state,'无有效目标'); return; }
      var rangeMap={melee:2,ranged:99,self:0};
      var range=rangeMap[skill.rangeType]||num(skill.range,2);
      if(range<99){
        var dx=num(p.x,0)-num(def.x,0), dy=num(p.y,0)-num(def.y,0);
        if(Math.round(Math.sqrt(dx*dx+dy*dy))>range){ addLog(state,'目标超出射程'); return; }
      }
      if(aoeRadius>0){
        state.units.forEach(function(u){
          if(u.isPlayer||u.hp<=0) return;
          var dx2=num(p.x,0)-num(u.x,0), dy2=num(p.y,0)-num(u.y,0);
          if(Math.round(Math.sqrt(dx2*dx2+dy2*dy2))<=aoeRadius) targets.push(u);
        });
        if(!targets.length){ addLog(state,'AOE范围内无目标'); return; }
      } else { targets=[def]; }
    }

    var hit=null;
    if(skill.hitExpr){
      var hitBase=num(skill.hitBase,0);
      hit=nebDice(skill.hitExpr, p);
      if(skill.shootingSpec){
        var sb=calcShootingBonus(skill.shootingSpec);
        hit.total+=sb.total+hitBase;
        hit.detail+=' +射击专精'+sb.diceStr+' +基础'+hitBase;
      } else if(hitBase>0){
        hit.total+=hitBase;
        hit.detail+=' +基础'+hitBase;
      }
      actionStr+='命中 '+hit.detail+'='+hit.total+(hit.crit?' [大成功]':'')+(hit.fumble?' [大失败]':'')+'\n';
    }

    targets.forEach(function(def){
      if(skill.hitExpr && !isSelf){
        var dodge=nebDice('rd敏捷', def);
        var hitSuccess=hit.total>dodge.total;
        actionStr+=def.name+'闪避 '+dodge.detail+'='+dodge.total+(dodge.fumble?' [大失败]':'')+'\n';
        actionStr+='-> '+(hitSuccess?'命中':'未命中')+'\n';
        if(hitSuccess && skill.damage){
          var dmg=nebDice(skill.damage, p);
          var dmgDealt=dmg.total;
          if(dmg.crit||hit.crit){ dmgDealt=dmg.total*2; }
          var hpBefore=def.hp;
          def.hp-=dmgDealt; if(def.hp<0) def.hp=0;
          actionStr+='伤害 '+dmg.detail+'='+dmg.total+(dmg.crit?' [大成功·翻倍='+dmgDealt+']':'')+'\n';
          actionStr+=def.name+' HP '+hpBefore+'->'+def.hp+'\n';
        }
        if(skill.debuffs&&skill.debuffs.length){
          skill.debuffs.forEach(function(db){
            if(!def.buffs) def.buffs=[];
            def.buffs.push({name:db.name,turns:num(db.turns,1),target:db.target||'',op:db.op||'+',val:db.val||'0'});
            actionStr+=def.name+'获得'+db.name+'('+db.turns+'回合)\n';
          });
        }
      }
      if(isSelf && skill.buffs){
        var healApplied=false;
        skill.buffs.forEach(function(bf){
          if(bf.target==='HP' && bf.op==='+' && !healApplied){
            var heal=nebDice(bf.val, p);
            p.hp=clamp(p.hp+heal.total,0,p.derived.hpMax);
            actionStr+='恢复HP '+heal.detail+'='+heal.total+' -> HP '+p.hp+'\n';
            healApplied=true;
          } else {
            if(!p.buffs) p.buffs=[];
            p.buffs.push({name:bf.name,turns:num(bf.turns,1),target:bf.target||'',op:bf.op||'+',val:bf.val||'0'});
            actionStr+='获得'+bf.name+'('+bf.turns+'回合)\n';
          }
        });
      }
    });

    var apCost=num(skill.apCost,0);
    p.ap-=apCost; p.hp-=apCost*5; if(p.hp<0) p.hp=0;
    if(!p.cooldowns) p.cooldowns={};
    if(num(skill.cooldown,0)>0) p.cooldowns[skillName]=num(skill.cooldown,0);
    calcDerived(p);
    actionStr+='消耗'+apCost+'AP/'+(apCost*5)+'HP(耐力) | AP->'+p.ap;
    if(skill.cooldown>0) actionStr+=' | 技能冷却:'+skill.cooldown+'回合';
    var report=buildReport(state, actionStr, rpText, '技能:'+skillName);
    addLog(state,report);
    executePlayerAction(state, report);
  }

  /* ===== 反击/双持/投掷 ===== */
  function doCounter(state, targetIdx, rpText){
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p||p.ap<1){ addLog(state,'AP不足（反击需要1AP）'); return; }
    var r=nebDice('r力量', p);
    p.ap-=1; p.hp-=5; if(p.hp<0) p.hp=0;
    var action='玩家反击！放弃闪避，消耗1AP进行反击攻击\n'+
      '反击命中 r力量='+r.detail+'='+r.total+(r.crit?' [大成功]':'')+(r.fumble?' [大失败]':'')+'\n'+
      '注：反击结果需与敌方命中值对比。若反击值>敌方命中值，反击命中并造成伤害。\n'+
      '消耗1AP/5HP(耐力) | AP->'+p.ap;
    var report=buildReport(state, action, rpText, '反击');
    addLog(state,report);
    executePlayerAction(state, report);
  }
  function doDualWield(state, targetIdx, rpText){
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p||p.hp<=0) return;
    if(p.ap<4){ addLog(state,'双持攻击需要4AP'); return; }
    var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer&&u.hp>0;});
    if(!def){ addLog(state,'无有效目标'); return; }
    var mainHit=nebDice('r力量', p);
    var offPen=dualWieldPenalty();
    var offHitTotal=mainHit.total-offPen.hitPen;
    var dodge=nebDice('rd敏捷', def);
    var action='玩家双持攻击 -> '+def.name+'\n';
    action+='主手命中 r力量='+mainHit.detail+'='+mainHit.total+'\n';
    action+='副手命中(主手-d10) '+mainHit.total+'-'+offPen.hitDetail+'='+offHitTotal+'\n';
    action+=def.name+'闪避 rd敏捷='+dodge.detail+'='+dodge.total+'\n';
    var mainSuccess=mainHit.total>dodge.total;
    var offSuccess=offHitTotal>dodge.total;
    action+='主手-> '+(mainSuccess?'命中':'未命中')+' | 副手-> '+(offSuccess?'命中':'未命中')+'\n';
    var totalDmg=0;
    if(mainSuccess){ var d1=nebDice('d4+DB',p); totalDmg+=d1.total; action+='主手伤害 '+d1.detail+'='+d1.total+'\n'; }
    if(offSuccess){ var d2=nebDice('d4+DB',p); var offDmg=Math.max(0,d2.total-offPen.dmgPen); totalDmg+=offDmg; action+='副手伤害 '+d2.detail+'='+d2.total+'-'+offPen.dmgDetail+'='+offDmg+'\n'; }
    if(totalDmg>0){ var hpB=def.hp; def.hp-=totalDmg; if(def.hp<0) def.hp=0; action+=def.name+' HP '+hpB+'->'+def.hp+'\n'; }
    p.ap-=4; p.hp-=20; if(p.hp<0) p.hp=0;
    action+='消耗4AP/20HP(耐力) | AP->'+p.ap;
    var report=buildReport(state, action, rpText, '双持攻击');
    addLog(state,report);
    executePlayerAction(state, report);
  }
  function doThrow(state, targetIdx, rpText){
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p||p.hp<=0) return;
    if(p.ap<2){ addLog(state,'投掷需要2AP'); return; }
    var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer&&u.hp>0;});
    if(!def){ addLog(state,'无有效目标'); return; }
    var str=num(p.eff?p.eff['力量']:p.attrs['力量'],10);
    var dx=num(p.x,0)-num(def.x,0), dy=num(p.y,0)-num(def.y,0);
    var dist=Math.round(Math.sqrt(dx*dx+dy*dy));
    if(dist>str){ addLog(state,'超出投掷距离！距离='+dist+'格，最大='+str+'格'); return; }
    var throwHit=calcThrowHit(p, 0);
    var dodge=nebDice('rd敏捷', def);
    var hitSuccess=throwHit.total>dodge.total;
    var action='玩家投掷攻击 -> '+def.name+' (距离'+dist+'格/最大'+str+'格)\n';
    action+='投掷命中 d(力量÷2) = '+throwHit.detail+'='+throwHit.total+'\n';
    action+=def.name+'闪避 rd敏捷='+dodge.detail+'='+dodge.total+'\n';
    action+='-> '+(hitSuccess?'命中':'未命中')+'\n';
    if(hitSuccess){
      var dmg=nebDice('d4+DB',p);
      var hpB=def.hp; def.hp-=dmg.total; if(def.hp<0) def.hp=0;
      action+='伤害 '+dmg.detail+'='+dmg.total+'\n'+def.name+' HP '+hpB+'->'+def.hp;
    }
    p.ap-=2; p.hp-=10; if(p.hp<0) p.hp=0;
    action+='\n消耗2AP/10HP(耐力) | AP->'+p.ap;
    var report=buildReport(state, action, rpText, '投掷攻击');
    addLog(state,report);
    executePlayerAction(state, report);
  }

  /* ===== 敌方行动解析 ===== */
  function parseEnemyAction(text){
    var results=[];
    var regex=/<enemy_action>\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^<]*?)\s*<\/enemy_action>/gi;
    var m;
    while((m=regex.exec(text))!==null){ results.push({actor:m[1].trim(),action:m[2].trim(),target:m[3].trim(),param:m[4].trim()}); }
    var regex2=/<enemy_action>\s*([^|]+?)\s*\|\s*([^|<]+?)\s*<\/enemy_action>/gi;
    while((m=regex2.exec(text))!==null){ results.push({actor:m[1].trim(),action:m[2].trim(),target:'',param:''}); }
    return results;
  }
  function resolveEnemyAction(state, ea){
    var actor=state.units.find(function(u){return u.name===ea.actor||u.id===ea.actor;});
    if(!actor||actor.hp<=0) return '敌方'+ea.actor+'无法行动(不存在或已倒下)';
    var target=state.units.find(function(u){return u.name===ea.target||u.id===ea.target;});
    if(!target) target=state.units.find(function(u){return u.isPlayer;});
    if(ea.action==='攻击'){
      var r=resolveAttack(actor,target,state);
      var apCost=(actor.weaponType==='twohand')?3:2;
      costAP(actor,apCost);
      addLog(state, r.summary+'\n'+actor.name+'消耗'+apCost+'AP');
      return r.summary+'\n'+actor.name+'消耗'+apCost+'AP/'+(apCost*5)+'HP(耐力)';
    }
    if(ea.action==='闪避'){
      var dr=nebDice('rd敏捷',actor);
      costAP(actor,1);
      addLog(state, actor.name+'闪避 '+dr.detail+'='+dr.total);
      return actor.name+'闪避='+dr.total+(dr.crit?'(大成功)':'')+(dr.fumble?'(大失败)':'')+'\n消耗1AP/5HP(耐力)';
    }
    if(ea.action==='移动'){
      var coords=ea.param.split(',');
      if(coords.length>=2){ actor.x=parseInt(coords[0],10)||actor.x; actor.y=parseInt(coords[1],10)||actor.y; }
      costAP(actor,1);
      addLog(state, actor.name+'移动到('+actor.x+','+actor.y+')');
      return actor.name+'移动到('+actor.x+','+actor.y+')';
    }
    if(ea.action==='防御'||ea.action==='等待'){ addLog(state, actor.name+'选择防御'); return actor.name+'选择防御姿态'; }
    if(ea.action==='逃跑'){ addLog(state, actor.name+'试图逃跑'); return actor.name+'试图逃跑'; }
    return actor.name+'执行:'+ea.action;
  }

  /* ===== 技能自动注册：解析<skill_register>标签 ===== */
  function parseSkillRegister(text){
    var results=[];
    var regex=/<skill_register>\s*([\s\S]*?)\s*<\/skill_register>/gi;
    var m;
    while((m=regex.exec(text))!==null){
      try{ results.push(JSON.parse(m[1].trim())); }catch(e){ console.warn('[战斗引擎v5] skill_register JSON解析失败',e); }
    }
    return results;
  }
  function registerSkill(skillData){
    if(!skillData||!skillData.name) return false;
    var cfg=getSkillConfig();
    var isNew=!cfg[skillData.name];
    skillData.name=String(skillData.name);
    skillData.type=skillData.type||'物理';
    skillData.category=skillData.category||'主动技能';
    skillData.hitBase=num(skillData.hitBase,0);
    skillData.hitExpr=skillData.hitExpr||'';
    skillData.apCost=num(skillData.apCost,3);
    skillData.range=num(skillData.range,2);
    skillData.rangeType=skillData.rangeType||'melee';
    skillData.damage=skillData.damage||'';
    skillData.cooldown=num(skillData.cooldown,0);
    skillData.aoeRadius=num(skillData.aoeRadius,0);
    skillData.isChanting=skillData.category==='吟唱技能'||!!skillData.isChanting;
    skillData.isInstant=skillData.category==='瞬发技能'||!!skillData.isInstant;
    skillData.buffs=skillData.buffs||[];
    skillData.debuffs=skillData.debuffs||[];
    skillData.desc=skillData.desc||'';
    cfg[skillData.name]=skillData;
    saveSkillConfig(cfg);
    console.log('[战斗引擎v5] 技能'+(isNew?'注册':'更新')+': '+skillData.name);
    return isNew;
  }
  function checkSkillRegister(){
    try{
      var msgs=getChatMessages('0-{{lastMessageId}}');
      if(!msgs||!msgs.length) return;
      var lastMsg=msgs[msgs.length-1];
      var text=lastMsg.message||lastMsg.mes||'';
      var skills=parseSkillRegister(text);
      if(skills.length===0) return;
      var state=getCombatState();
      skills.forEach(function(sd){
        var isNew=registerSkill(sd);
        if(state&&state.active){
          addLog(state, (isNew?'★ 新技能注册': '技能更新')+': '+sd.name+(sd.apCost?(' ('+sd.apCost+'AP)'):''));
        }
      });
      if(state&&state.active){ saveCombatState(state); renderAllPanels(); }
    }catch(e){ console.error('[战斗引擎v5] 技能注册检查失败',e); }
  }

  /* ===== stat_data技能名同步 ===== */
  function syncSkillsFromStatData(data){
    if(!data) return;
    var rawSkills=getValue(data,'个人档案.强化与技能.技能列表',null);
    if(!rawSkills||typeof rawSkills!=='object') return;
    var cfg=getSkillConfig();
    var statNames=Object.keys(rawSkills);
    var changed=false;
    statNames.forEach(function(name){
      if(!cfg[name]){
        var s=rawSkills[name];
        cfg[name]={
          name:name, type:'物理', category:'主动技能',
          hitBase:0, hitExpr:'', apCost:3, range:2, rangeType:'melee',
          damage:'d4+DB', cooldown:0, aoeRadius:0,
          isChanting:false, isInstant:false,
          buffs:[], debuffs:[],
          desc:getValue(s,'描述','')||''
        };
        changed=true;
      }
    });
    if(changed){ saveSkillConfig(cfg); console.log('[战斗引擎v5] 从stat_data同步新技能'); }
  }

  /* ===== 渲染 ===== */
  function bar(pct, cls, idPrefix){
    pct=clamp(pct,0,100);
    return '<div class="'+idPrefix+'-bar-track"><i class="'+idPrefix+'-bar-fill '+cls+'" style="width:'+pct+'%"></i></div>';
  }
  function apDots(cur,max,idPrefix){
    var h=''; for(var i=0;i<max;i++){ h+='<span class="'+idPrefix+'-ap-dot'+(i<cur?' on':'')+'"></span>'; } return h;
  }
  var state_targetIdx=1;

  function renderUnit(u, idx, idPrefix){
    calcDerived(u);
    var hpPct=u.derived.hpMax>0?(u.hp/u.derived.hpMax*100):0;
    var enPct=u.derived.energyMax>0?(u.energy/u.derived.energyMax*100):0;
    var cls=u.isPlayer?'player':'enemy';
    var h='<div class="'+idPrefix+'-unit '+cls+'" data-u="'+idx+'">'+
      '<div class="'+idPrefix+'-unit-head"><span class="'+idPrefix+'-unit-name">'+esc(u.name)+'</span>'+
        '<span class="'+idPrefix+'-unit-tag">'+(u.isPlayer?'玩家':'敌人')+' ('+u.x+','+u.y+')</span></div>';
    h+='<div class="'+idPrefix+'-bar-line"><span class="'+idPrefix+'-bar-label">HP</span>'+
       bar(hpPct, hpPct<30?'hp low':'hp', idPrefix)+
       '<span class="'+idPrefix+'-bar-val">'+u.hp+'/'+u.derived.hpMax+
       '<span class="'+idPrefix+'-hp-ctrl"><button data-hp="'+idx+'" data-d="-5">-</button><button data-hp="'+idx+'" data-d="5">+</button></span></span></div>';
    if(u.derived.energyMax>0){
      h+='<div class="'+idPrefix+'-bar-line"><span class="'+idPrefix+'-bar-label">'+esc(u.energyType||'能量').slice(0,2)+'</span>'+
         bar(enPct,'energy',idPrefix)+'<span class="'+idPrefix+'-bar-val">'+u.energy+'/'+u.derived.energyMax+'</span></div>';
    }
    h+='<div class="'+idPrefix+'-ap-row"><span class="'+idPrefix+'-ap-label">AP</span>'+
       apDots(u.ap,u.derived.apMax,idPrefix)+'<span class="'+idPrefix+'-ap-info">'+u.ap+'/'+u.derived.apMax+'</span></div>';
    h+='<div class="'+idPrefix+'-attrs">';
    ATTRS.forEach(function(a){
      var base=num(u.attrs[a],10), eff=num(u.eff[a],10);
      var bcls=''; if(eff>base) bcls='buffed'; else if(eff<base) bcls='debuffed';
      h+='<div class="'+idPrefix+'-attr-chip '+bcls+'"><span class="n">'+a+'</span><span class="v">'+eff+(eff!==base?' ('+base+')':'')+'</span></div>';
    });
    h+='</div>';
    h+='<div class="'+idPrefix+'-derived">'+
      '<div class="'+idPrefix+'-derived-chip"><span class="n">物防</span><span class="v">'+u.derived.physDef+'</span></div>'+
      '<div class="'+idPrefix+'-derived-chip"><span class="n">神防</span><span class="v">'+u.derived.mystDef+'</span></div>'+
      '<div class="'+idPrefix+'-derived-chip"><span class="n">暴击</span><span class="v">'+u.derived.critRate+'%</span></div>'+
      '<div class="'+idPrefix+'-derived-chip"><span class="n">移速</span><span class="v">'+u.derived.moveSpeed+'m</span></div>'+
      '</div>';
    if(u.buffs&&u.buffs.length){
      h+='<div class="'+idPrefix+'-buffs">';
      u.buffs.forEach(function(b,bi){
        var isDeb=(b.op==='+'&&num(b.val,0)<0);
        var chip=isDeb?idPrefix+'-chip-debuff':idPrefix+'-chip-buff';
        var lbl=b.name+' ('+b.turns+'回合)';
        if(b.target&&b.op&&b.val) lbl+=' ['+b.op+''+b.val+' '+b.target+']';
        h+='<span class="'+chip+'" data-buff="'+idx+'" data-bi="'+bi+'" title="点击移除">'+esc(lbl)+'</span>';
      });
      h+='</div>';
    }
    var cds=Object.keys(u.cooldowns||{}).filter(function(k){ return u.cooldowns[k]>0; });
    if(cds.length){
      h+='<div class="'+idPrefix+'-buffs">';
      cds.forEach(function(k){ h+='<span class="'+idPrefix+'-chip-cooldown">'+esc(k)+' CD:'+u.cooldowns[k]+'</span>'; });
      h+='</div>';
    }
    if(!u.isPlayer){
      h+='<div style="margin-top:6px"><button class="'+idPrefix+'-btn '+(idx===state_targetIdx?idPrefix+'-btn-primary':'')+'" data-target="'+idx+'" style="font-size:10px;padding:3px 8px">'+(idx===state_targetIdx?'当前目标':'设为目标')+'</button></div>';
    }
    h+='</div>';
    return h;
  }

  function renderActions(u, idPrefix){
    if(!u) return '';
    var h='<div class="'+idPrefix+'-actions">';
    h+='<button class="'+idPrefix+'-act-btn" data-act="attack">普通攻击<span class="'+idPrefix+'-ap-cost">'+((u.weaponType==='twohand')?3:2)+'AP</span></button>';
    h+='<button class="'+idPrefix+'-act-btn" data-act="aoe">AOE攻击<span class="'+idPrefix+'-ap-cost">'+((u.weaponType==='twohand')?3:2)+'AP</span></button>';
    h+='<button class="'+idPrefix+'-act-btn" data-act="dodge">闪避<span class="'+idPrefix+'-ap-cost">1AP</span></button>';
    h+='<span class="'+idPrefix+'-act-sep"></span>';
    h+='<button class="'+idPrefix+'-act-btn" data-act="parry" data-pt="weapon">武器格挡<span class="'+idPrefix+'-ap-cost">1AP</span></button>';
    h+='<button class="'+idPrefix+'-act-btn" data-act="parry" data-pt="shield1h">单手盾<span class="'+idPrefix+'-ap-cost">1AP</span></button>';
    h+='<button class="'+idPrefix+'-act-btn" data-act="parry" data-pt="shield2h">双手盾<span class="'+idPrefix+'-ap-cost">1AP</span></button>';
    h+='<button class="'+idPrefix+'-act-btn" data-act="parry" data-pt="barehand">空手<span class="'+idPrefix+'-ap-cost">1AP</span></button>';
    h+='<span class="'+idPrefix+'-act-sep"></span>';
    h+='<button class="'+idPrefix+'-act-btn" data-act="move" data-mode="walk">走路<span class="'+idPrefix+'-ap-cost">1AP</span></button>';
    h+='<button class="'+idPrefix+'-act-btn" data-act="move" data-mode="run">跑步<span class="'+idPrefix+'-ap-cost">2AP</span></button>';
    h+='<span class="'+idPrefix+'-act-sep"></span>';
    h+='<button class="'+idPrefix+'-act-btn" data-act="atktype">攻击:'+(u.atkType==='magic'?'法术':'物理')+'</button>';
    h+='<button class="'+idPrefix+'-act-btn" data-act="wtype">武器:'+(u.weaponType==='twohand'?'双手':'单手')+'</button>';
    h+='</div>';
    /* RP输入框 */
    h+='<div class="'+idPrefix+'-section" style="background:rgba(255,255,255,0.55);border:1px solid rgba(255,255,255,0.7);border-radius:14px;padding:12px;margin-bottom:10px;">';
    h+='<div style="font-size:12px;color:#6b6488;margin-bottom:6px;font-weight:600;">RP描述（可选，附加到战报）</div>';
    h+='<textarea id="'+idPrefix+'-rp-input" placeholder="描述你的行动/台词，或留空纯投骰..." style="width:100%;min-height:50px;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:10px;padding:8px 12px;font-size:12px;color:#463f63;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>';
    h+='<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">';
    h+='<button class="'+idPrefix+'-btn" data-act="customaction" style="font-size:11px;">✍ 自定义行动</button>';
    h+='<button class="'+idPrefix+'-btn" data-act="counter" style="font-size:11px;">反击(1AP)</button>';
    h+='<button class="'+idPrefix+'-btn" data-act="dualwield" style="font-size:11px;">双持攻击(4AP)</button>';
    h+='<button class="'+idPrefix+'-btn" data-act="throw" style="font-size:11px;">投掷(2AP)</button>';
    h+='<button class="'+idPrefix+'-btn" data-act="skilledit" style="font-size:11px;">⚙ 技能编辑器</button>';
    h+='</div></div>';
    /* 技能按钮 */
    var cfg=getSkillConfig();
    h+='<div class="'+idPrefix+'-section" style="background:rgba(255,255,255,0.55);border:1px solid rgba(255,255,255,0.7);border-radius:14px;padding:12px;margin-bottom:10px;">';
    h+='<div style="font-size:12px;color:#6b6488;margin-bottom:6px;font-weight:600;">技能（点击使用）</div>';
    h+='<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    Object.keys(cfg).forEach(function(name){
      var s=cfg[name];
      var onCD=u.cooldowns&&u.cooldowns[name]>0;
      var cdTxt=onCD?' (CD:'+u.cooldowns[name]+')':'';
      var style=onCD?'opacity:0.4;cursor:not-allowed;':'cursor:pointer;';
      h+='<button class="'+idPrefix+'-act-btn" data-skill="'+esc(name)+'" style="'+style+'"'+(onCD?'disabled':'')+'>'+esc(name)+'<span style="font-size:9px;color:#ed8936;margin-left:4px;">'+esc(s.apCost)+'AP'+esc(cdTxt)+'</span></button>';
    });
    h+='</div>';
    h+='</div>';
    return h;
  }

  function renderLog(state, idPrefix){
    var h='<div class="'+idPrefix+'-log" id="'+idPrefix+'-log-box">';
    if(!state.log||!state.log.length){ h+='<div class="'+idPrefix+'-empty">暂无战斗记录</div>'; }
    else{ state.log.slice(-25).forEach(function(e){ h+='<div class="'+idPrefix+'-log-entry">'+esc(e.text)+'</div>'; }); }
    h+='</div>';
    return h;
  }

  function renderConsole(state, mount){
    var idPrefix='cb';
    var data=fetchStatData();
    if(data){ syncSkillsFromStatData(data); }
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p&&data){ p=seedPlayer(data); state.units.push(p); calcDerived(p); saveCombatState(state); }
    if(p&&data){
      ATTRS.forEach(function(k){ p.attrs[k]=getValue(data,'个人档案.战斗属性.'+k,p.attrs[k]); });
      var hpMaxNew=getValue(data,'个人档案.衍生属性.生命值.最大',0);
      if(hpMaxNew&&hpMaxNew>0) p.hpMaxBase=hpMaxNew;
      p.energyType=getValue(data,'个人档案.衍生属性.能量值.类型',p.energyType);
      calcDerived(p);
    }
    var phaseLabel={
      IDLE:'未开始',
      PLAYER_ACTING:'\ud83d\udfe0 等待玩家行动',
      AI_GENERATING:'\ud83d\udd34 AI演绎中...',
      ENEMY_RESOLVING:'\ud83d\udfe1 敌方结算中...',
      COMBAT_END:'\u2694 战斗结束'
    }[state.phase]||state.phase;
    var phaseColor={IDLE:'#6b6488',PLAYER_ACTING:'#48bb78',AI_GENERATING:'#e53e3e',ENEMY_RESOLVING:'#d69e2e',COMBAT_END:'#a78bfa'}[state.phase]||'#6b6488';
    var h='<div class="'+idPrefix+'-console">'+
      '<div class="'+idPrefix+'-topbar">'+
        '<div class="'+idPrefix+'-topbar-title">\u2694 战斗控制台 <span class="'+idPrefix+'-turn-badge">回合'+state.turn+'</span> <span class="'+idPrefix+'-phase-badge" style="color:'+phaseColor+';-webkit-text-fill-color:'+phaseColor+';">'+esc(phaseLabel)+'</span></div>'+
        '<div class="'+idPrefix+'-topbar-btns">'+
          '<button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary" data-act="addbuff">施加状态</button>'+
          '<button class="'+idPrefix+'-btn '+idPrefix+'-btn-danger" data-act="endcombat">结束战斗</button>'+
        '</div>'+
      '</div><div class="'+idPrefix+'-body">';
    h+='<div class="'+idPrefix+'-unit-grid">';
    state.units.forEach(function(u,i){ h+=renderUnit(u,i,idPrefix); });
    h+='</div>';
    var activeUnit=state.units[0]||p;
    if(state.phase==='PLAYER_ACTING') h+=renderActions(activeUnit,idPrefix);
    else if(state.phase==='AI_GENERATING') h+='<div class="'+idPrefix+'-empty">\u23f3 AI正在演绎战斗...请稍候</div>';
    else if(state.phase==='ENEMY_RESOLVING') h+='<div class="'+idPrefix+'-empty">\u23f3 敌方行动结算中...</div>';
    else if(state.phase==='COMBAT_END') h+='<div class="'+idPrefix+'-empty" style="color:#a78bfa;">\u2694 战斗已结束</div>';
    else h+='<div class="'+idPrefix+'-empty">战斗未开始</div>';
    if(state.phase==='IDLE'||!state.active){
      h+='<div class="'+idPrefix+'-section"><div class="'+idPrefix+'-section-title">添加敌人后开始战斗</div>'+
        '<div class="'+idPrefix+'-add-enemy-row">'+
        '<div class="'+idPrefix+'-add-enemy-field"><label>名称</label><input class="wide" id="'+idPrefix+'-en-name" value="哥布林"></div>'+
        '<div class="'+idPrefix+'-add-enemy-field"><label>HP</label><input id="'+idPrefix+'-en-hp" value="30"></div>'+
        '<div class="'+idPrefix+'-add-enemy-field"><label>力量</label><input id="'+idPrefix+'-en-str" value="12"></div>'+
        '<div class="'+idPrefix+'-add-enemy-field"><label>敏捷</label><input id="'+idPrefix+'-en-agi" value="14"></div>'+
        '<div class="'+idPrefix+'-add-enemy-field"><label>体质</label><input id="'+idPrefix+'-en-con" value="10"></div>'+
        '<button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary" data-act="addenemy">添加</button>'+
        '<button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary" data-act="startcombat">开始战斗</button>'+
        '</div></div>';
    }
    h+='<div class="'+idPrefix+'-section"><div class="'+idPrefix+'-section-title">投骰台（r力量 / rd敏捷 / d20 / 3d6 / d4+DB / 取低 / 取高）</div>'+
      '<div class="'+idPrefix+'-dice-input"><input id="'+idPrefix+'-dice-expr" placeholder="例如：r力量 或 d20+5">'+
      '<button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary" data-act="freeroll">投骰</button></div>'+
      '<div class="'+idPrefix+'-dice-quick">'+
        '<button data-quick="r力量">r力量</button><button data-quick="rd敏捷">rd敏捷</button>'+
        '<button data-quick="r智力">r智力</button><button data-quick="d20">d20</button>'+
        '<button data-quick="d100">d100</button><button data-quick="3d6">3d6</button>'+
        '<button data-quick="d4+DB">d4+DB</button>'+
      '</div></div>';
    h+=renderLog(state,idPrefix);
    h+='</div></div>';
    mount.innerHTML=h;
    var logBox=mount.querySelector('#'+idPrefix+'-log-box');
    if(logBox) logBox.scrollTop=logBox.scrollHeight;
  }

  function renderBar(mount){
    mount.innerHTML='<div class="cb-bar" data-act="startcombat">'+
      '<div class="cb-bar-title">⚔ 战斗控制台</div>'+
      '<div class="cb-bar-sub">点击开始战斗 -></div></div>';
  }

  var mounts=[];
  var renderTimer=null;
  function renderAllPanels(){
    if(renderTimer) clearTimeout(renderTimer);
    renderTimer=setTimeout(function(){
      mounts.forEach(function(m){
        if(!m||!m.parentNode) return;
        var state=getCombatState();
        if(!state||!state.active){ renderBar(m); }
        else { renderConsole(state, m); }
      });
      mounts=mounts.filter(function(m){ return m&&m.parentNode; });
    }, 50);
  }
  function renderCombatPanel(mount){
    if(!mount) return;
    mounts=mounts.filter(function(m){ return m&&m.parentNode&&m!==mount; });
    mounts.push(mount);
    var state=getCombatState();
    if(!state||!state.active){ renderBar(mount); }
    else { renderConsole(state, mount); }
  }

  /* ===== v5核心：cbHandleClick - 供regex壳调用 ===== */
  function cbHandleClick(act, data, mount){
    var state=getCombatState();
    if(!state) state={turn:0,units:[],log:[],phase:'IDLE',active:false};

    if(act==='startcombat'){
      var d=fetchStatData();
      state={turn:1,units:[],log:[],phase:'PLAYER_ACTING',active:true,targetIdx:1,combatMessageId:null};
      if(d){ var p=seedPlayer(d); calcDerived(p); state.units.push(p); }
      else { var p=makeEnemy('玩家',40,12,12,12,12,12,12); p.isPlayer=true; p.id='player'; calcDerived(p); state.units.push(p); }
      var enName='哥布林',enHp=30,enStr=12,enAgi=14,enCon=10;
      try{ enName=mount.querySelector('#cb-en-name').value||'哥布林'; }catch(e){}
      try{
        enHp=parseInt(mount.querySelector('#cb-en-hp').value||'30',10);
        enStr=mount.querySelector('#cb-en-str').value;
        enAgi=mount.querySelector('#cb-en-agi').value;
        enCon=mount.querySelector('#cb-en-con').value;
      }catch(e){}
      var enemy=makeEnemy(enName,enHp,enStr,enAgi,enCon,8,8,8);
      calcDerived(enemy); state.units.push(enemy);
      addLog(state,'-- 战斗开始 · 回合1 --');
      var initReport=buildReport(state, '战斗开始！'+state.units.map(function(u){return u.name+' HP'+u.hp+'/'+u.derived.hpMax;}).join(' vs '), '', '战斗开始');
      var msgContent='<CombatHud/>\n\n'+initReport;
      saveCombatState(state);
      try{
        if(typeof createChatMessages==='function'){
          createChatMessages([{role:'assistant', message:msgContent}], {refresh:'affected'}).then(function(){
            try{
              if(typeof getLastMessageId==='function'){
                state.combatMessageId=getLastMessageId();
                saveCombatState(state);
              }
            }catch(e){}
          });
        }
      }catch(e){ console.error('[战斗引擎v5] 创建战斗消息层失败',e); }
      renderAllPanels();
      return;
    }
    if(act==='endcombat'){
      addLog(state,'-- 战斗结束 --');
      appendCombatToLayer('\u2550\u2550\u2550 \u6218\u6597\u7ed3\u675f\uff08\u624b\u52a8\uff09 \u2550\u2550\u2550');
      clearCombatState();
      renderAllPanels();
      return;
    }
    if(!state.active) return;
    if(state.phase==='AI_GENERATING'||state.phase==='ENEMY_RESOLVING'){
      return;
    }
    if(state.phase!=='PLAYER_ACTING') return;

    var rpText='';
    try{
      var rpInput=mount.querySelector('#cb-rp-input');
      if(rpInput) rpText=rpInput.value.trim();
    }catch(e){}

    if(act==='attack'){ doPlayerAttack(state, state.targetIdx||1, false, 0, rpText); renderAllPanels(); return; }
    if(act==='aoe'){
      var radius=prompt('AOE范围半径(格)：','2');
      if(radius) doPlayerAttack(state, state.targetIdx||1, true, parseInt(radius,10), rpText);
      renderAllPanels(); return;
    }
    if(act==='dodge'){ doDodge(state, rpText); renderAllPanels(); return; }
    if(act==='parry'){ doParry(state, data.pt||'weapon', rpText); renderAllPanels(); return; }
    if(act==='move'){ doMove(state, data.mode||'walk', rpText); renderAllPanels(); return; }
    if(act==='freeroll'){
      var input=mount.querySelector('#cb-dice-expr');
      doFreeRoll(state, input?input.value:'d20', rpText); renderAllPanels(); return;
    }
    if(act==='customaction'){
      if(!rpText){ addLog(state,'请在RP输入框描述你的行动'); return; }
      var rollType=prompt('选择投骰类型（留空=不投骰纯RP）：\nr力量 / rd敏捷 / r智力 / d20 / d100 / 3d6', '');
      if(rollType===null) return;
      rollType=rollType.trim();
      doCustomAction(state, rpText, rollType);
      renderAllPanels(); return;
    }
    if(act==='atktype'){
      var p=state.units.find(function(u){return u.isPlayer;});
      if(p){ p.atkType=(p.atkType==='magic'?'phys':'magic'); saveCombatState(state); renderAllPanels(); } return;
    }
    if(act==='wtype'){
      var p=state.units.find(function(u){return u.isPlayer;});
      if(p){ p.weaponType=(p.weaponType==='twohand'?'onehand':'twohand'); saveCombatState(state); renderAllPanels(); } return;
    }
    if(act==='addenemy'){
      var name=prompt('敌人名称：','哥布林'); if(!name) return;
      var hp=parseInt(prompt('HP：','30')||'30',10);
      var str=prompt('力量(默认12)：','12')||12;
      var agi=prompt('敏捷(默认14)：','14')||14;
      var con=prompt('体质(默认10)：','10')||10;
      var en2=makeEnemy(name,hp,str,agi,con,8,8,8);
      calcDerived(en2); state.units.push(en2);
      state.targetIdx=state.units.length-1;
      addLog(state, name+'加入战场(HP '+hp+')');
      saveCombatState(state); renderAllPanels(); return;
    }
    if(act==='addbuff'){ openBuffModal(state); return; }
    if(act==='counter'){ doCounter(state, state.targetIdx||1, rpText); renderAllPanels(); return; }
    if(act==='dualwield'){ doDualWield(state, state.targetIdx||1, rpText); renderAllPanels(); return; }
    if(act==='throw'){ doThrow(state, state.targetIdx||1, rpText); renderAllPanels(); return; }
    if(act==='skilledit'){ openSkillEditor(); return; }
  }

  function cbHandleHp(idx, delta){
    var state=getCombatState(); if(!state) return;
    adjustHP(state, idx, delta); renderAllPanels();
  }
  function cbHandleTarget(idx){
    var state=getCombatState(); if(!state) return;
    state.targetIdx=idx; state_targetIdx=idx;
    saveCombatState(state); renderAllPanels();
  }
  function cbHandleBuff(unitIdx, buffIdx){
    var state=getCombatState(); if(!state) return;
    removeBuff(state, unitIdx, buffIdx); renderAllPanels();
  }
  function cbHandleQuick(expr, mount){
    var state=getCombatState(); if(!state) return;
    if(state.phase!=='PLAYER_ACTING') return;
    var input=mount.querySelector('#cb-dice-expr');
    if(input) input.value=expr;
    var rpText='';
    try{ var rpInput=mount.querySelector('#cb-rp-input'); if(rpInput) rpText=rpInput.value.trim(); }catch(e){}
    doFreeRoll(state, expr, rpText); renderAllPanels();
  }
  function cbHandleSkill(skillName){
    var state=getCombatState(); if(!state) return;
    if(state.phase!=='PLAYER_ACTING') return;
    var rpText='';
    try{ var mounts_=mounts; for(var i=0;i<mounts_.length;i++){ var m=mounts_[i]; if(m&&m.parentNode){ var rpInput=m.querySelector('#cb-rp-input'); if(rpInput){ rpText=rpInput.value.trim(); break; } } } }catch(e){}
    doSkill(state, skillName, state.targetIdx||1, rpText); renderAllPanels();
  }

  /* ===== Buff Modal ===== */
  function openBuffModal(state){
    var overlay=HOST.document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    var unitOpts=state.units.map(function(u,i){ return '<option value="'+i+'">'+esc(u.name)+'</option>'; }).join('');
    overlay.innerHTML='<div style="background:#f3eefc;border:1px solid rgba(167,139,250,0.5);border-radius:14px;padding:18px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(140,120,200,0.18);font-family:inherit;color:#463f63;">'+
      '<div style="font-weight:700;margin-bottom:10px;font-size:14px;">施加 Buff / Debuff</div>'+
      '<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">目标单位</label><select id="cb-mf-unit" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;">'+unitOpts+'</select></div>'+
      '<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">状态名称</label><input id="cb-mf-name" placeholder="如：力量增幅" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;"></div>'+
      '<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">持续回合</label><input id="cb-mf-turns" value="3" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;"></div>'+
      '<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">作用属性</label><select id="cb-mf-target" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;">'+
        '<option value="">（仅标记）</option><option value="力量">力量</option><option value="敏捷">敏捷</option>'+
        '<option value="体质">体质</option><option value="智力">智力</option><option value="精神">精神</option>'+
        '<option value="能量值最大">能量值最大(×)</option></select></div>'+
      '<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">运算</label><select id="cb-mf-op" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;">'+
        '<option value="+">+ 加法(可负)</option><option value="*">× 乘法(如2=翻倍)</option></select></div>'+
      '<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">数值</label><input id="cb-mf-val" value="10" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;"></div>'+
      '<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:12px;">'+
        '<button id="cb-mf-cancel" style="background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;">取消</button>'+
        '<button id="cb-mf-ok" style="background:rgba(167,139,250,0.2);border:1px solid rgba(167,139,250,0.5);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;color:#463f63;font-weight:600;">施加</button></div>'+
    '</div>';
    HOST.document.body.appendChild(overlay);
    overlay.querySelector('#cb-mf-cancel').onclick=function(){ overlay.remove(); };
    overlay.querySelector('#cb-mf-ok').onclick=function(){
      var ui=parseInt(overlay.querySelector('#cb-mf-unit').value,10);
      var name=overlay.querySelector('#cb-mf-name').value||'状态';
      var turns=parseInt(overlay.querySelector('#cb-mf-turns').value||'3',10);
      var target=overlay.querySelector('#cb-mf-target').value;
      var op=overlay.querySelector('#cb-mf-op').value;
      var val=overlay.querySelector('#cb-mf-val').value;
      addBuff(state, ui, name, turns, target, op, val);
      overlay.remove(); renderAllPanels();
    };
  }

  /* ===== 技能编辑器 ===== */
  function openSkillEditor(){
    var cfg=getSkillConfig();
    var overlay=HOST.document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    var modal=HOST.document.createElement('div');
    modal.style.cssText='background:#f3eefc;border:1px solid rgba(167,139,250,0.5);border-radius:18px;padding:20px;max-width:520px;width:92%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(140,120,200,0.18);font-family:inherit;color:#463f63;';
    var html='<div style="font-weight:700;font-size:16px;margin-bottom:12px;color:#a78bfa;">技能配置编辑器</div>';
    html+='<div id="skill-list" style="margin-bottom:12px;">';
    Object.keys(cfg).forEach(function(name){
      var s=cfg[name];
      html+='<div style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:10px;padding:8px 12px;margin-bottom:6px;cursor:pointer;" data-edit-skill="'+esc(name)+'">'+
        '<b style="color:#a78bfa;">'+esc(name)+'</b> <span style="font-size:10px;color:#6b6488;">'+esc(s.type)+'/'+esc(s.category)+' AP:'+esc(s.apCost)+' CD:'+esc(s.cooldown)+'</span>'+
        '<div style="font-size:10px;color:#6b6488;margin-top:2px;">'+esc(s.desc||'')+'</div></div>';
    });
    html+='</div>';
    html+='<div style="display:flex;gap:6px;">';
    html+='<input id="new-skill-name" placeholder="新技能名称" style="flex:1;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:5px 10px;font-size:12px;color:#463f63;">';
    html+='<button id="add-skill-btn" style="background:rgba(167,139,250,0.2);border:1px solid rgba(167,139,250,0.4);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;color:#a78bfa;font-weight:600;">添加</button>';
    html+='<button id="close-skill-editor" style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;color:#463f63;">关闭</button>';
    html+='</div>';
    modal.innerHTML=html; overlay.appendChild(modal);
    HOST.document.body.appendChild(overlay);
    overlay.querySelector('#close-skill-editor').onclick=function(){ overlay.remove(); };
    overlay.querySelector('#add-skill-btn').onclick=function(){
      var name=overlay.querySelector('#new-skill-name').value.trim();
      if(!name) return;
      if(cfg[name]){ alert('技能已存在'); return; }
      cfg[name]={name:name,type:'物理',category:'主动技能',hitBase:0,hitExpr:'r力量',apCost:3,range:2,rangeType:'melee',damage:'d4+DB',cooldown:2,aoeRadius:0,isChanting:false,isInstant:false,buffs:[],debuffs:[],desc:''};
      saveSkillConfig(cfg); overlay.remove(); openSkillEditor();
    };
    var els=overlay.querySelectorAll('[data-edit-skill]');
    for(var i=0;i<els.length;i++){
      els[i].onclick=function(){
        var sn=this.getAttribute('data-edit-skill');
        overlay.remove(); openSkillEditForm(sn);
      };
    }
  }
  function openSkillEditForm(skillName){
    var cfg=getSkillConfig();
    var s=cfg[skillName]; if(!s) return;
    var overlay=HOST.document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    var modal=HOST.document.createElement('div');
    modal.style.cssText='background:#f3eefc;border:1px solid rgba(167,139,250,0.5);border-radius:18px;padding:20px;max-width:460px;width:92%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(140,120,200,0.18);font-family:inherit;color:#463f63;';
    function field(label,id,val,ph){ return '<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;display:block;">'+label+'</label><input id="'+id+'" value="'+esc(val)+'" placeholder="'+esc(ph||'')+'" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:5px 10px;font-size:12px;color:#463f63;"></div>'; }
    function sel(label,id,opts,val){ var h='<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;display:block;">'+label+'</label><select id="'+id+'" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:5px 10px;font-size:12px;color:#463f63;">'; opts.forEach(function(o){var v=typeof o==='object'?o.v:o,l=typeof o==='object'?o.l:o; h+='<option value="'+esc(v)+'"'+(v===val?' selected':'')+'>'+esc(l)+'</option>';}); h+='</select></div>'; return h; }
    modal.innerHTML='<div style="font-weight:700;font-size:15px;margin-bottom:12px;color:#a78bfa;">编辑技能: '+esc(skillName)+'</div>'+
      field('名称','se-name',s.name)+
      sel('类型','se-type',['物理','法术','辅助','召唤'],s.type)+
      sel('分类','se-category',[{v:'主动技能',l:'主动技能(3AP)'},{v:'瞬发技能',l:'瞬发技能(1AP)'},{v:'吟唱技能',l:'吟唱技能(5AP)'},{v:'连发技能',l:'连发技能(0AP)'}],s.category)+
      field('命中表达式','se-hitExpr',s.hitExpr,'r力量 / r智力 / d20 / 空=必中')+
      field('基础命中加成','se-hitBase',s.hitBase,'数字')+
      field('AP消耗','se-apCost',s.apCost,'如3')+
      sel('射程类型','se-rangeType',[{v:'melee',l:'近战(2格)'},{v:'ranged',l:'远程(99格)'},{v:'self',l:'自身'}],s.rangeType)+
      field('伤害表达式','se-damage',s.damage,'d4+DB / d6+DB / 空=无伤害')+
      field('冷却回合','se-cooldown',s.cooldown,'如3')+
      field('AOE半径','se-aoeRadius',s.aoeRadius,'0=单体')+
      field('射击专精','se-shootingSpec',s.shootingSpec||'','F/E-/D-')+
      field('描述','se-desc',s.desc,'技能描述')+
      field('buffs(JSON)','se-buffs',JSON.stringify(s.buffs||[]),'[]')+
      field('debuffs(JSON)','se-debuffs',JSON.stringify(s.debuffs||[]),'[]')+
      '<div style="display:flex;gap:6px;margin-top:12px;">'+
        '<button id="se-save" style="flex:1;background:rgba(167,139,250,0.2);border:1px solid rgba(167,139,250,0.4);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;color:#a78bfa;font-weight:600;">保存</button>'+
        '<button id="se-delete" style="background:rgba(229,62,62,0.1);border:1px solid rgba(229,62,62,0.3);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;color:#e53e3e;">删除</button>'+
        '<button id="se-cancel" style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;color:#463f63;">取消</button></div>';
    overlay.appendChild(modal);
    HOST.document.body.appendChild(overlay);
    overlay.querySelector('#se-cancel').onclick=function(){ overlay.remove(); };
    overlay.querySelector('#se-delete').onclick=function(){ if(confirm('确认删除？')){ delete cfg[skillName]; saveSkillConfig(cfg); overlay.remove(); } };
    overlay.querySelector('#se-save').onclick=function(){
      var newName=overlay.querySelector('#se-name').value.trim();
      var updated={name:newName,type:overlay.querySelector('#se-type').value,category:overlay.querySelector('#se-category').value,
        hitExpr:overlay.querySelector('#se-hitExpr').value.trim(),hitBase:num(overlay.querySelector('#se-hitBase').value,0),
        apCost:num(overlay.querySelector('#se-apCost').value,3),rangeType:overlay.querySelector('#se-rangeType').value,
        damage:overlay.querySelector('#se-damage').value.trim(),cooldown:num(overlay.querySelector('#se-cooldown').value,0),
        aoeRadius:num(overlay.querySelector('#se-aoeRadius').value,0),
        shootingSpec:overlay.querySelector('#se-shootingSpec').value.trim()||undefined,
        desc:overlay.querySelector('#se-desc').value.trim(),
        isChanting:overlay.querySelector('#se-category').value==='吟唱技能',
        isInstant:overlay.querySelector('#se-category').value==='瞬发技能'};
      try{ updated.buffs=JSON.parse(overlay.querySelector('#se-buffs').value||'[]'); }catch(e){ updated.buffs=[]; }
      try{ updated.debuffs=JSON.parse(overlay.querySelector('#se-debuffs').value||'[]'); }catch(e){ updated.debuffs=[]; }
      if(newName!==skillName){ delete cfg[skillName]; }
      cfg[newName]=updated; saveSkillConfig(cfg); overlay.remove();
    };
  }

  /* ===== 事件监听（v5：HOST作用域，仅技能注册） ===== */
  function bindTavernEvents(){
    try{
      var evOn=(typeof HOST.eventOn==='function')?HOST.eventOn:((typeof eventOn==='function')?eventOn:null);
      var evts=(typeof HOST.tavern_events!=='undefined')?HOST.tavern_events:((typeof tavern_events!=='undefined')?tavern_events:null);
      if(evOn&&evts){
        if(evts.CHARACTER_MESSAGE_RENDERED){ evOn(evts.CHARACTER_MESSAGE_RENDERED, function(){ setTimeout(checkSkillRegister, 400); }); }
        if(evts.MESSAGE_UPDATED){ evOn(evts.MESSAGE_UPDATED, function(){ setTimeout(checkSkillRegister, 400); }); }
        if(evts.GENERATION_ENDED){ evOn(evts.GENERATION_ENDED, function(){ setTimeout(checkSkillRegister, 600); }); }
      }
    }catch(e){ console.warn('[战斗引擎v5] 事件绑定失败',e); }
  }
  bindTavernEvents();

  /* ===== 暴露API到HOST ===== */
  HOST.renderCombatPanel = renderCombatPanel;
  HOST.cbHandleClick = cbHandleClick;
  HOST.cbHandleHp = cbHandleHp;
  HOST.cbHandleTarget = cbHandleTarget;
  HOST.cbHandleBuff = cbHandleBuff;
  HOST.cbHandleQuick = cbHandleQuick;
  HOST.cbHandleSkill = cbHandleSkill;
  HOST.openSkillEditor = openSkillEditor;
  HOST.checkSkillRegister = checkSkillRegister;
  HOST.registerSkill = registerSkill;
  HOST.syncSkillsFromStatData = syncSkillsFromStatData;
  HOST.getCombatState = getCombatState;
  HOST.startCombatSession = startCombatSession;
  HOST.appendCombatToLayer = appendCombatToLayer;
  HOST.combatAction = function(act, params){
    var state=getCombatState(); if(!state) return;
    if(state.phase!=='PLAYER_ACTING') return;
    var rpText=(params&&params.rpText)||'';
    switch(act){
      case 'attack': doPlayerAttack(state, params&&params.target||1, false, 0, rpText); break;
      case 'dodge': doDodge(state, rpText); break;
      case 'parry': doParry(state, params&&params.pt||'weapon', rpText); break;
      case 'move': doMove(state, params&&params.mode||'walk', rpText); break;
      case 'freeroll': doFreeRoll(state, params&&params.expr||'d20', rpText); break;
      case 'custom': doCustomAction(state, rpText, params&&params.rollType||''); break;
    }
    renderAllPanels();
  };

  console.log('[多维矩阵·战斗引擎] v5 已加载（同层战斗+generate静默+RP输入+自定义行动+HP归零检测）');
})();
