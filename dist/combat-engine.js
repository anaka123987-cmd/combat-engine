/**
 * 多维矩阵·战斗引擎 v6
 * 通用骰子引擎 + 技能/装备卡片系统 + 多动作回合 + 伤害类型防御 + 消耗品 + 敌人生成
 */
(function(){
  'use strict';
  var HOST=(typeof window!=='undefined'&&window.top)?window.top:(typeof self!=='undefined'?self:window);
  HOST.__combatEngineV6=true; HOST.__combatEngineV5=true; HOST.__combatEngineV4=true;

  /* ===== 工具函数 ===== */
  function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
  function num(v,d){ var n=parseFloat(v); return isNaN(n)?(d||0):n; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function getValue(data,path,def){ if(def===undefined)def='-'; if(!data)return def; try{ var ks=String(path).split('.'),cur=data; for(var i=0;i<ks.length;i++){ if(cur===null||typeof cur!=='object')return def; cur=cur[ks[i]]; } return (cur!==undefined&&cur!==null)?cur:def; }catch(e){ return def; } }
  function getRaw(data,path,d){ if(d===undefined)d=null; if(!data)return d; try{ var ks=String(path).split('.'),cur=data; for(var i=0;i<ks.length;i++){ if(cur===null||typeof cur!=='object')return d; cur=cur[ks[i]]; } return (cur!==undefined&&cur!==null)?cur:d; }catch(e){ return d; } }

  var ATTRS=['力量','敏捷','体质','智力','精神','魅力'];
  var WEAPON_RANGE={onehand:2,twohand:2,pistol:99,shotgun:5,melee:2};
  var ROLL_TARGETS={命中:'attack',攻击:'attack',伤害:'damage',防御:'defense',闪避:'dodge',格挡:'parry',暴击:'crit'};

  /* ======================================================================
   * 通用骰子引擎 (Universal Dice Engine)
   * 支持: d20, 3d6, d18+2, d20+敏捷-d5, (d6+2)*3, r力量, rd敏捷, DB
   * Context: { 力量:12, 力量buffs:["d5"], attackMods:["d5","+2"], damageMods:["d3"] }
   * 每次投骰时重新roll buff骰子
   * ====================================================================== */
  function rollDie(faces){ if(faces<1)faces=1; return Math.floor(Math.random()*faces)+1; }
  function lookupDB(statVal){ if(statVal>=31)return{dice:'d4',faces:4,bonus:5}; if(statVal>=26)return{dice:'d4',faces:4,bonus:3}; if(statVal>=21)return{dice:'d2',faces:2,bonus:3}; if(statVal>=16)return{dice:'d2',faces:2,bonus:1}; if(statVal>=11)return{dice:null,faces:0,bonus:1}; return{dice:null,faces:0,bonus:0}; }

  /* --- Tokenizer --- */
  function tokenize(expr){
    var tokens=[], i=0, s=String(expr).replace(/\s+/g,'');
    while(i<s.length){
      var c=s[i];
      if(c==='+'||c==='-'||c==='*'||c==='/'||c==='('||c===')'){ tokens.push({t:c}); i++; continue; }
      if(c==='d'||c==='D'){
        var j=i+1, numstr='';
        while(j<s.length && s[j]>='0' && s[j]<='9'){ numstr+=s[j]; j++; }
        if(numstr){ tokens.push({t:'dice',faces:parseInt(numstr,10),count:1}); i=j; continue; }
        else{ tokens.push({t:'dice',faces:0,count:1}); i++; continue; }
      }
      if(c>='0'&&c<='9'){
        var ns='';
        while(i<s.length && s[i]>='0' && s[i]<='9'){ ns+=s[i]; i++; }
        if(s[i]==='d'||s[i]==='D'){
          i++; var fs='';
          while(i<s.length && s[i]>='0' && s[i]<='9'){ fs+=s[i]; i++; }
          tokens.push({t:'dice',faces:parseInt(fs||'0',10),count:parseInt(ns,10)});
        } else {
          tokens.push({t:'num',val:parseInt(ns,10)});
        }
        continue;
      }
      /* 属性引用: r力量, rd敏捷, DB, 力量, 敏捷, 物防, 神防, etc. */
      if(c==='r'){
        var matched=false;
        for(var a=0;a<ATTRS.length;a++){
          var attr=ATTRS[a];
          if(s.substring(i+1,i+1+attr.length)===attr){ tokens.push({t:'rattr',attr:attr}); i+=1+attr.length; matched=true; break; }
        }
        if(matched) continue;
        if(s[i+1]==='d'){
          for(var a2=0;a2<ATTRS.length;a2++){
            var attr2=ATTRS[a2];
            if(s.substring(i+2,i+2+attr2.length)===attr2){ tokens.push({t:'rattr',attr:attr2}); i+=2+attr2.length; matched=true; break; }
          }
        }
        if(matched) continue;
      }
      if(c==='D'&&s.substring(i,i+2)==='DB'){ tokens.push({t:'db'}); i+=2; continue; }
      var attrMatched=false;
      for(var a3=0;a3<ATTRS.length;a3++){
        if(s.substring(i,i+ATTRS[a3].length)===ATTRS[a3]){ tokens.push({t:'attr',attr:ATTRS[a3]}); i+=ATTRS[a3].length; attrMatched=true; break; }
      }
      if(attrMatched) continue;
      if(s.substring(i,i+2)==='物防'){ tokens.push({t:'attr',attr:'物防'}); i+=2; continue; }
      if(s.substring(i,i+2)==='神防'){ tokens.push({t:'attr',attr:'神防'}); i+=2; continue; }
      if(s.substring(i,i+2)==='移速'){ tokens.push({t:'attr',attr:'移速'}); i+=2; continue; }
      if(s.substring(i,i+2)==='暴击'){ tokens.push({t:'attr',attr:'暴击'}); i+=2; continue; }
      i++;
    }
    return tokens;
  }

  /* --- Recursive Descent Parser --- */
  function DiceParser(tokens){
    this.tokens=tokens; this.pos=0;
  }
  DiceParser.prototype.peek=function(){ return this.tokens[this.pos]; };
  DiceParser.prototype.next=function(){ return this.tokens[this.pos++]; };
  DiceParser.prototype.parseExpr=function(){
    var left=this.parseTerm();
    while(this.peek() && (this.peek().t==='+'||this.peek().t==='-')){
      var op=this.next().t;
      var right=this.parseTerm();
      left={type:'binop',op:op,left:left,right:right};
    }
    return left;
  };
  DiceParser.prototype.parseTerm=function(){
    var left=this.parseFactor();
    while(this.peek() && (this.peek().t==='*'||this.peek().t==='/')){
      var op=this.next().t;
      var right=this.parseFactor();
      left={type:'binop',op:op,left:left,right:right};
    }
    return left;
  };
  DiceParser.prototype.parseFactor=function(){
    var tk=this.peek();
    if(!tk) return {type:'num',val:0};
    if(tk.t==='('){ this.next(); var e=this.parseExpr(); if(this.peek()&&this.peek().t===')') this.next(); return e; }
    if(tk.t==='num'){ this.next(); return {type:'num',val:tk.val}; }
    if(tk.t==='dice'){ this.next(); return {type:'dice',faces:tk.faces,count:tk.count||1}; }
    if(tk.t==='rattr'){ this.next(); return {type:'rattr',attr:tk.attr}; }
    if(tk.t==='attr'){ this.next(); return {type:'attr',attr:tk.attr}; }
    if(tk.t==='db'){ this.next(); return {type:'db'}; }
    if(tk.t==='-'){ this.next(); var f=this.parseFactor(); return {type:'binop',op:'-',left:{type:'num',val:0},right:f}; }
    this.next(); return {type:'num',val:0};
  };

  /* --- Evaluator with context (buffs re-rolled each time) --- */
  function evalNode(node, ctx, rolls, detail, depth){
    if(depth===undefined)depth=0;
    if(!node) return 0;
    switch(node.type){
      case 'num': detail.push(String(node.val)); return node.val;
      case 'dice':{
        if(node.faces<1) node.faces=1;
        var sum=0, rr=[];
        for(var d=0; d<node.count; d++){ var r=rollDie(node.faces); rolls.push({die:node.count>1?node.count+'d'+node.faces:'d'+node.faces,faces:node.faces,result:r}); sum+=r; rr.push(r); }
        detail.push((node.count>1?node.count:'')+'d'+node.faces+'=['+rr.join('+')+']');
        return sum;
      }
      case 'rattr':{
        var val=ctx.attrs[node.attr]||10; if(val<1)val=1;
        /* Re-roll buff formulas for this attribute */
        var mods=ctx.attrMods[node.attr]||[];
        var modSum=0, modDetail=[];
        mods.forEach(function(mf){
          var mr=evalDiceStr(mf, ctx, rolls, modDetail, depth+1);
          modSum+=mr.total;
        });
        var r=rollDie(val);
        rolls.push({die:'r'+node.attr,faces:val,result:r});
        var total=r+modSum;
        detail.push('r'+node.attr+'=[d'+val+'='+r+']'+(mods.length?' +buff('+modDetail.join(' ')+')':''));
        return total;
      }
      case 'attr':{
        if(node.attr==='物防'){ var v=ctx.derived?ctx.derived.physDef:0; detail.push('物防='+v); return v; }
        if(node.attr==='神防'){ var v2=ctx.derived?ctx.derived.mystDef:0; detail.push('神防='+v2); return v2; }
        if(node.attr==='移速'){ var v3=ctx.derived?ctx.derived.moveSpeed:0; detail.push('移速='+v3); return v3; }
        if(node.attr==='暴击'){ var v4=ctx.derived?ctx.derived.critRate:0; detail.push('暴击='+v4); return v4; }
        var av=ctx.attrs[node.attr]||0;
        /* Re-roll buff formulas for this attribute */
        var aMods=ctx.attrMods[node.attr]||[];
        var aModSum=0, aModDetail=[];
        aMods.forEach(function(mf2){ var amr=evalDiceStr(mf2,ctx,rolls,aModDetail,depth+1); aModSum+=amr.total; });
        detail.push(node.attr+'='+(av+aModSum));
        return av+aModSum;
      }
      case 'db':{
        var dbAttr=ctx.isMagic?(ctx.attrs['智力']||10):(ctx.attrs['力量']||10);
        var db=lookupDB(dbAttr);
        var dbSum=0;
        if(db.dice){ var dr=rollDie(db.faces); rolls.push({die:db.dice,faces:db.faces,result:dr}); dbSum+=dr; detail.push('DB('+db.dice+'='+dr+')'); }
        dbSum+=db.bonus; detail.push('DB+'+db.bonus);
        return dbSum;
      }
      case 'binop':{
        var l=evalNode(node.left,ctx,rolls,detail,depth);
        var r2=evalNode(node.right,ctx,rolls,detail,depth);
        var res=0;
        if(node.op==='+')res=l+r2; else if(node.op==='-')res=l-r2; else if(node.op==='*')res=l*r2; else if(node.op==='/')res=Math.floor(l/(r2||1));
        return res;
      }
    }
    return 0;
  }

  /* Evaluate a dice string with context */
  function evalDiceStr(str, ctx, rolls, detail, depth){
    if(depth===undefined)depth=0;
    var s=String(str).trim(); if(!s) s='0';
    var adv=/取高/.test(s), dis=/取低/.test(s);
    s=s.replace(/取低|取高/g,'').trim(); if(!s)s='d20';
    var tokens=tokenize(s);
    var parser=new DiceParser(tokens);
    var ast=parser.parseExpr();
    if(!rolls)rolls=[];
    if(!detail)detail=[];
    if(adv||dis){
      var r1=[],d1=[]; evalNode(ast,ctx,r1,d1,depth);
      var r2=[],d2=[]; evalNode(ast,ctx,r2,d2,depth);
      var t1=evalNode(ast,ctx,r1,d1,depth);
      var t2=evalNode(ast,ctx,r2,d2,depth);
      if(adv){ rolls.push.apply(rolls,r1); detail.push(d1.join(' ')+' | '+d2.join(' ')+' → 取高='+Math.max(t1,t2)); return {total:Math.max(t1,t2),rolls:rolls,detail:detail.join(' ')}; }
      else { rolls.push.apply(rolls,r1); detail.push(d1.join(' ')+' | '+d2.join(' ')+' → 取低='+Math.min(t1,t2)); return {total:Math.min(t1,t2),rolls:rolls,detail:detail.join(' ')}; }
    }
    var t=evalNode(ast,ctx,rolls,detail,depth);
    return {total:t,rolls:rolls,detail:detail.join(' ')};
  }

  /* Build buffed context for a unit and roll type */
  function buildBuffedContext(unit, rollType){
    var ctx={attrs:{},attrMods:{},rollMods:[],derived:unit.derived,isMagic:unit.atkType==='magic'};
    ATTRS.forEach(function(a){ ctx.attrs[a]=num(unit.eff?unit.eff[a]:unit.attrs[a],10); });
    /* Collect active buff formulas */
    (unit.buffs||[]).forEach(function(b){
      if(b.effect==='attr_mod' && b.target){
        if(!ctx.attrMods[b.target])ctx.attrMods[b.target]=[];
        ctx.attrMods[b.target].push(b.formula);
      }
      if(b.effect==='roll_mod' && b.rollTarget===rollType){
        ctx.rollMods.push(b.formula);
      }
    });
    return ctx;
  }

  /* nebDice — backward compatible wrapper with context */
  function nebDice(expr, unit, rollType){
    var s=String(expr).trim().replace(/取低|取高/g,'').trim(); if(!s)s='d20';
    var ctx;
    if(unit){
      ctx=buildBuffedContext(unit, rollType||'');
      /* Add roll mods from buffs */
      var rollMods=ctx.rollMods||[];
      if(rollMods.length){ s=s+'+'+rollMods.join('+'); }
    } else {
      ctx={attrs:{},attrMods:{},isMagic:false};
    }
    var rolls=[],detail=[];
    var result=evalDiceStr(s,ctx,rolls,detail);
    var crit=false,fumble=false;
    for(var i=0;i<rolls.length;i++){
      if(rolls[i].faces>1 && rolls[i].result===rolls[i].faces)crit=true;
      if(rolls[i].faces>1 && rolls[i].result===1)fumble=true;
    }
    if(crit&&fumble)fumble=false;
    return {expr:expr,total:result.total,rolls:rolls,detail:result.detail,crit:crit,fumble:fumble};
  }

  /* ===== 衍生属性计算 ===== */
  function getBuffMod(unit,attr){
    var sum=0; (unit.buffs||[]).forEach(function(b){ if(b.effect==='attr_mod'&&b.target===attr) sum+=num(b.flatVal,0); });
    return sum;
  }
  function calcDerived(unit){
    var eff={};
    ATTRS.forEach(function(k){ eff[k]=num(unit.attrs[k],10)+getBuffMod(unit,k); });
    unit.eff=eff;
    var d={};
    d.apMax=4+Math.floor((eff['敏捷']-10)/20); if(d.apMax<1)d.apMax=1;
    d.moveSpeed=Math.floor(eff['敏捷']/5);
    d.physDef=Math.floor(eff['体质']/2)+num(unit.equipBonus&&unit.equipBonus.physDef,0);
    d.mystDef=Math.floor(eff['精神']/2)+num(unit.equipBonus&&unit.equipBonus.mystDef,0);
    d.critRate=5+num(unit.equipBonus&&unit.equipBonus.crit,0);
    d.energyMax=Math.floor((num(eff['精神'],10)+num(unit.equipBonus&&unit.equipBonus.energy,0)));
    if(d.energyMax<1)d.energyMax=1;
    d.hpMax=num(unit.hpMaxBase,d.energyMax); if(d.hpMax<1)d.hpMax=1;
    if(unit.hp==null||unit.hp<0)unit.hp=d.hpMax;
    if(unit.hp>d.hpMax)unit.hp=d.hpMax;
    if(unit.energy==null||unit.energy<0)unit.energy=d.energyMax;
    if(unit.energy>d.energyMax)unit.energy=d.energyMax;
    unit.derived=d;
  }

  /* ===== 距离计算 ===== */
  function distance(a,b){ var dx=num(a.x,0)-num(b.x,0),dy=num(a.y,0)-num(b.y,0); return Math.round(Math.sqrt(dx*dx+dy*dy)); }
  function inRange(att,t,wt){ var d=distance(att,t); var r=WEAPON_RANGE[wt||'melee']||2; return d<=r; }
  function unitsInAOE(o,r,us){ var h=[]; us.forEach(function(u){ if(u.hp<=0)return; if(distance(o,u)<=r)h.push(u); }); return h; }

  /* ===== MVU stat_data读取 ===== */
  function fetchStatData(){
    try{
      if(typeof getChatMessages==='function'){
        var msgs=getChatMessages('0-{{lastMessageId}}');
        if(msgs&&msgs.length){
          for(var i=msgs.length-1;i>=0;i--){ var m=msgs[i]; var d=(m&&m.data&&m.data.stat_data)||(m&&m.stat_data); if(d)return d; }
        }
      }
    }catch(e){}
    return null;
  }

  /* ===== 聊天变量读写 ===== */
  function getCombatState(){
    try{ if(typeof getVariables==='function'){ var v=getVariables({type:'chat'}); if(v&&v.combat_state)return v.combat_state; } }catch(e){}
    return null;
  }
  function saveCombatState(state){
    try{ if(typeof insertOrAssignVariables==='function'){ insertOrAssignVariables({combat_state:state},{type:'chat'}); } }catch(e){ console.error('[战斗引擎v6] 保存状态失败',e); }
  }
  function clearCombatState(){
    try{ if(typeof insertOrAssignVariables==='function'){ insertOrAssignVariables({combat_state:null},{type:'chat'}); } }catch(e){}
  }

  /* ======================================================================
   * 效果解析管线 (Effect Parsing Pipeline)
   * 解析技能/装备的特殊效果文本 → 结构化效果对象
   * ====================================================================== */
  function parseEffectString(category, text){
    if(!text||!String(text).trim())return null;
    text=String(text).trim();
    switch(category){
      case '增伤':
        return {effect:'roll_mod',rollTarget:'damage',formula:text};
      case '属性提升':{
        var m=text.match(/^(\S+?)\s*([+\-*/])\s*([^\/]+?)(?:\/(\d+)回合)?$/);
        if(m)return {effect:'attr_mod',target:m[1],op:m[2],formula:m[3],duration:m[4]?parseInt(m[4],10):-1};
        return {effect:'special',text:text};
      }
      case '施加负面':{
        var m2=text.match(/^([^\/]+)\/([^\/]+)(?:\/(\d+)回合)?$/);
        if(m2)return {effect:'debuff_apply',name:m2[1].trim(),formula:m2[2].trim(),duration:m2[3]?parseInt(m2[3],10):1,target:'enemy'};
        return {effect:'special',text:text};
      }
      case '增加buff':{
        var m3=text.match(/^([^\/+]+?)\s*([+\-])\s*([^\/]+?)(?:\/(\d+)回合)?$/);
        if(m3)return {effect:'buff_apply',name:m3[1].trim(),op:m3[2],formula:m3[3].trim(),duration:m3[4]?parseInt(m3[4],10):-1};
        return {effect:'special',text:text};
      }
      case '增加判定':{
        var m4=text.match(/^([^+]+?)\s*([+\-])\s*(.+)$/);
        if(m4){ var rt=ROLL_TARGETS[m4[1].trim()]||'attack'; return {effect:'roll_mod',rollTarget:rt,op:m4[2],formula:m4[3].trim()}; }
        return {effect:'special',text:text};
      }
      case '其他效果':
        return {effect:'special',text:text};
    }
    return null;
  }

  function parseEffectsObj(effectsObj){
    if(!effectsObj||typeof effectsObj!=='object')return [];
    var results=[];
    var cats=['增伤','属性提升','施加负面','增加buff','增加判定','其他效果'];
    cats.forEach(function(cat){
      var val=effectsObj[cat];
      if(!val||!String(val).trim())return;
      var parsed=parseEffectString(cat,val);
      if(parsed)results.push(parsed);
    });
    return results;
  }

  /* ======================================================================
   * 卡片数据读取 (Card Data Reading from MVU)
   * ====================================================================== */
  function readSkillCards(data){
    if(!data)return{};
    var raw=getValue(data,'个人档案.强化与技能.技能列表',null);
    if(!raw||typeof raw!=='object')return{};
    var cards={};
    Object.keys(raw).forEach(function(name){
      var s=raw[name]; if(!s||typeof s!=='object')return;
      cards[name]={
        name:name,
        动作类型:getRaw(s,'动作类型','主动'),
        AP消耗:num(getRaw(s,'AP消耗',getRaw(s,'apCost',2)),2),
        伤害类型:getRaw(s,'伤害类型','物理'),
        伤害:getRaw(s,'伤害',getRaw(s,'damage','')),
        特殊效果:getRaw(s,'特殊效果',{}),
        范围:getRaw(s,'范围','近战/单体'),
        持续时间:getRaw(s,'持续时间','0回合'),
        冷却:num(getRaw(s,'冷却',getRaw(s,'cooldown',0)),0),
        能量消耗:num(getRaw(s,'能量消耗',0),0),
        学习难度:getRaw(s,'学习难度','F'),
        等级:getRaw(s,'等级','Lv.1'),
        描述:getRaw(s,'描述',getRaw(s,'desc','')),
        _effects:parseEffectsObj(getRaw(s,'特殊效果',{}))
      };
    });
    return cards;
  }

  function readEquipmentCards(data){
    if(!data)return{};
    var raw=getValue(data,'背包与商城.背包.物品列表',null);
    if(!raw||typeof raw!=='object')return{};
    var cards={};
    Object.keys(raw).forEach(function(name){
      var item=raw[name]; if(!item||typeof item!=='object')return;
      var equipData=getRaw(item,'装备数据',null);
      if(!equipData||typeof equipData!=='object')return;
      cards[name]={
        name:name,
        槽位:getRaw(equipData,'槽位','武器'),
        伤害:getRaw(equipData,'伤害',''),
        护甲:num(getRaw(equipData,'护甲',0),0),
        伤害类型:getRaw(equipData,'伤害类型','物理'),
        特殊效果:getRaw(equipData,'特殊效果',{}),
        范围:getRaw(equipData,'范围','近战/单体'),
        冷却:num(getRaw(equipData,'冷却',0),0),
        能量消耗:num(getRaw(equipData,'能量消耗',0),0),
        装备要求:getRaw(equipData,'装备要求',''),
        _item:item,
        _effects:parseEffectsObj(getRaw(equipData,'特殊效果',{}))
      };
    });
    return cards;
  }

  function readConsumableCards(data){
    if(!data)return{};
    var raw=getValue(data,'背包与商城.背包.物品列表',null);
    if(!raw||typeof raw!=='object')return{};
    var cards={};
    Object.keys(raw).forEach(function(name){
      var item=raw[name]; if(!item||typeof item!=='object')return;
      var useEffect=getRaw(item,'使用效果',getRaw(item,'效果',''));
      if(!useEffect)return;
      cards[name]={
        name:name,
        数量:num(getRaw(item,'数量',1),1),
        类型:getRaw(item,'类型','消耗品'),
        品质:getRaw(item,'品质','白'),
        使用效果:useEffect,
        描述:getRaw(item,'描述',''),
        _item:item
      };
    });
    return cards;
  }

  function getEquippedSlots(data){
    if(!data)return{};
    var quick=getValue(data,'背包与商城.背包.快捷栏',null);
    var slots={武器:null,副手:null,防具:null,饰品:null};
    if(quick&&typeof quick==='object'){
      Object.keys(quick).forEach(function(k){
        var name=quick[k]; if(!name||name==='-')return;
        if(k==='1'||k==='2')slots['武器']=name;
        else if(k==='3')slots['副手']=name;
        else if(k==='4')slots['防具']=name;
        else if(k==='5'||k==='6')slots['饰品']=name;
      });
    }
    return slots;
  }

  /* ===== 单位创建 ===== */
  function seedPlayer(data){
    var p={
      id:'player', name:getValue(data,'主页.代号','')||getValue(data,'主页.姓名','玩家'), isPlayer:true,
      attrs:{
        '力量':num(getValue(data,'个人档案.战斗属性.力量',10),10),
        '敏捷':num(getValue(data,'个人档案.战斗属性.敏捷',10),10),
        '体质':num(getValue(data,'个人档案.战斗属性.体质',10),10),
        '智力':num(getValue(data,'个人档案.战斗属性.智力',10),10),
        '精神':num(getValue(data,'个人档案.战斗属性.精神',10),10),
        '魅力':num(getValue(data,'个人档案.战斗属性.魅力',10),10)
      },
      hpMaxBase:num(getValue(data,'个人档案.衍生属性.生命值.最大',0),0),
      hp:num(getValue(data,'个人档案.衍生属性.生命值.当前',0),0),
      energy:num(getValue(data,'个人档案.衍生属性.能量值.当前',0),0),
      energyType:getValue(data,'个人档案.衍生属性.能量值.类型','能量'),
      ap:4, buffs:[], cooldowns:{}, pendingActions:[],
      equipBonus:{physDef:0,mystDef:0,crit:0,energy:0},
      equippedSlots:getEquippedSlots(data),
      atkType:'phys', weaponType:'onehand', x:2, y:5
    };
    applyEquipmentBonuses(p,data);
    return p;
  }
  function makeEnemy(name,hp,str,agi,con,int,spi,cha){
    return {id:'e'+Date.now(),name:name||'敌人',isPlayer:false,
      attrs:{'力量':str||10,'敏捷':agi||10,'体质':con||10,'智力':int||10,'精神':spi||10,'魅力':cha||10},
      hpMaxBase:hp||30,hp:hp||30,energy:0,energyType:'能量',ap:4,buffs:[],cooldowns:{},pendingActions:[],
      equipBonus:{physDef:0,mystDef:0,crit:0,energy:0},equippedSlots:{},
      atkType:'phys',weaponType:'onehand',x:7,y:5};
  }

  /* ===== 装备被动效果应用 ===== */
  function applyEquipmentBonuses(unit, data){
    if(!data||!unit.equippedSlots)return;
    var equipCards=readEquipmentCards(data);
    Object.keys(unit.equippedSlots).forEach(function(slot){
      var itemName=unit.equippedSlots[slot];
      if(!itemName)return;
      var card=equipCards[itemName]; if(!card)return;
      /* 被动效果: 属性提升, 增加判定 — 永久生效 */
      card._effects.forEach(function(eff){
        if(eff.effect==='attr_mod'){
          if(!unit.buffs)unit.buffs=[];
          unit.buffs.push({name:'装备:'+itemName,effect:'attr_mod',target:eff.target,op:eff.op||'+',formula:eff.formula,flatVal:0,turns:-1,source:itemName,sourceType:'equipment'});
        }
        if(eff.effect==='roll_mod'){
          if(!unit.buffs)unit.buffs=[];
          unit.buffs.push({name:'装备:'+itemName,effect:'roll_mod',rollTarget:eff.rollTarget,formula:eff.formula,turns:-1,source:itemName,sourceType:'equipment'});
        }
      });
      /* 护甲加成 */
      if(card.护甲>0){
        if(card.槽位==='防具')unit.equipBonus.physDef+=card.护甲;
      }
    });
  }

  /* ===== 回合tick ===== */
  function tick(state){
    state.turn++;
    state.units.forEach(function(u){
      if(u.hp<=0)return;
      Object.keys(u.cooldowns||{}).forEach(function(k){ u.cooldowns[k]--; if(u.cooldowns[k]<=0)delete u.cooldowns[k]; });
      (u.buffs||[]).forEach(function(b){ if(b.turns>0)b.turns--; });
      u.buffs=(u.buffs||[]).filter(function(b){ return b.turns===-1||b.turns>0; });
      calcDerived(u); u.ap=u.derived.apMax;
    });
    addLog(state,'-- 回合 '+state.turn+' -- AP恢复满，冷却/buff递减 --');
  }
  function addLog(state,text,cls){ if(!state.log)state.log=[]; state.log.push({turn:state.turn,text:text,cls:cls||''}); if(state.log.length>60)state.log.shift(); }
  function costAP(unit,ap){ unit.ap-=ap; unit.hp-=ap*5; if(unit.hp<0)unit.hp=0; }

  /* ===== 战报构建 ===== */
  function buildReport(state, action, rpText, phaseLabel){
    var p=state.units.find(function(u){return u.isPlayer;});
    var enemies=state.units.filter(function(u){return !u.isPlayer;});
    var buffStr=function(u){ if(!u.buffs||!u.buffs.length)return''; return u.buffs.filter(function(b){return b.turns!==-1;}).map(function(b){return b.name+'('+b.turns+'回合)';}).join(','); };
    var report='═══ 回合'+state.turn+' · '+(phaseLabel||'玩家')+' ═══\n';
    if(rpText)report+='> '+rpText+'\n';
    var status='【状态】';
    if(p){ status+='玩家'+p.name+' HP'+p.hp+'/'+p.derived.hpMax+' AP'+p.ap+'/'+p.derived.apMax+' 能量'+p.energy+'/'+p.derived.energyMax+' ('+p.x+','+p.y+')'; if(buffStr(p))status+=' buff:'+buffStr(p); }
    if(enemies.length){ status+=' | '; status+=enemies.map(function(e){ var s=e.name+'HP'+e.hp+'/'+e.derived.hpMax+' ('+e.x+','+e.y+')'; if(buffStr(e))s+=' buff:'+buffStr(e); return s; }).join(' '); if(p)status+=' 距离'+distance(p,enemies[0])+'格'; }
    report+=status+'\n';
    if(action)report+=action+'\n';
    return report;
  }
  function buildBattleSnapshot(state){
    var p=state.units.find(function(u){return u.isPlayer;});
    var enemies=state.units.filter(function(u){return !u.isPlayer;});
    var snap='【战场快照】回合'+state.turn+'\n';
    if(p){ snap+='玩家: '+p.name+' HP'+p.hp+'/'+p.derived.hpMax+' AP'+p.ap+'/'+p.derived.apMax+' 能量'+p.energy+'/'+p.derived.energyMax+' 位置('+p.x+','+p.y+')'; if(p.buffs&&p.buffs.length){ snap+=' buff: '+p.buffs.filter(function(b){return b.turns!==-1;}).map(function(b){return b.name+'('+b.turns+'回合)';}).join(', '); } snap+='\n'; }
    enemies.forEach(function(e){ snap+=e.name+': HP'+e.hp+'/'+e.derived.hpMax+' AP'+e.ap+'/'+e.derived.apMax+' 位置('+e.x+','+e.y+')'; if(e.buffs&&e.buffs.length){ snap+=' buff: '+e.buffs.filter(function(b){return b.turns!==-1;}).map(function(b){return b.name+'('+b.turns+'回合)';}).join(', '); } snap+='\n'; });
    if(enemies.length&&p){ var d=distance(p,enemies[0]); snap+='距离: 玩家↔'+enemies[0].name+'='+d+'格 ('+(inRange(p,enemies[0],p.weaponType)?'可攻击':'超出射程')+')\n'; }
    return snap;
  }

  /* ===== 同层追加 ===== */
  function scrollChatToBottom(){ try{ var chat=HOST.document.querySelector('#chat'); if(chat)chat.scrollTop=chat.scrollHeight; }catch(e){} }
  async function appendCombatToLayer(text){
    var state=getCombatState(); if(!state||state.combatMessageId==null)return;
    var msgId=state.combatMessageId;
    try{
      var msgs=getChatMessages(msgId); if(msgs&&msgs.length){ var msg=msgs[0]; var nc=(msg.message||'')+'\n\n'+text; if(typeof setChatMessages==='function'){ await setChatMessages([{message_id:msgId,message:nc}],{refresh:'none'}); } }
    }catch(e){ console.error('[战斗引擎v6] 持久化战报失败',e); }
    try{
      if(typeof retrieveDisplayedMessage==='function'&&typeof formatAsDisplayedMessage==='function'){ var $mes=retrieveDisplayedMessage(msgId); if($mes&&$mes.length){ var html=formatAsDisplayedMessage(text,{message_id:msgId}); $mes.append(html); } }
    }catch(e){ console.error('[战斗引擎v6] DOM追加战报失败',e); }
    scrollChatToBottom();
  }

  /* ===== 静默调用AI ===== */
  async function callAI(report){
    var state=getCombatState(); if(!state)throw new Error('战斗状态不存在');
    var snapshot=buildBattleSnapshot(state);
    var userInput=report+'\n\n请演绎战斗过程并给出敌方反应，在回复末尾输出<enemy_action>敌方行动者|行动类型|目标|参数</enemy_action>。不要自行计算数值。';
    if(typeof generate!=='function')throw new Error('generate函数不可用，请确保酒馆助手已安装');
    var reply=await generate({user_input:userInput,should_silence:true,max_chat_history:5,injects:[{role:'system',content:snapshot,position:'in_chat',depth:0,should_scan:true}]});
    return String(reply);
  }

  /* ===== 净化AI回复 ===== */
  function cleanAIReply(text){
    var t=String(text||'');
    t=t.replace(/<enemy_spawn>[\s\S]*?<\/enemy_spawn>/gi,'');
    t=t.replace(/<enemy_spawn>[\s\S]*$/gi,'');
    t=t.replace(/<enemy_action>[\s\S]*?<\/enemy_action>/gi,'');
    t=t.replace(/<enemy_action>[\s\S]*$/gi,'');
    t=t.replace(/<update(?:variable)?>\s*[\s\S]*?<\/update(?:variable)?>/gi,'');
    t=t.replace(/<update(?:variable)?>\s*[\s\S]*$/gi,'');
    t=t.replace(/<skill_register>[\s\S]*?<\/skill_register>/gi,'');
    t=t.replace(/<skill_register>[\s\S]*$/gi,'');
    return t.trim();
  }

  /* ===== HP归零检测 ===== */
  function checkCombatEnd(state){
    var p=state.units.find(function(u){return u.isPlayer;});
    var enemies=state.units.filter(function(u){return !u.isPlayer;});
    var playerDead=p&&p.hp<=0;
    var allDead=enemies.length>0&&enemies.every(function(e){return e.hp<=0;});
    if(playerDead||allDead){
      state.phase='COMBAT_END'; state.active=false;
      var msg=playerDead?'玩家阵亡，战斗失败！':'所有敌人被击败，战斗胜利！';
      addLog(state,'-- '+msg+' --');
      appendCombatToLayer('═══ 战斗结束 · '+msg+' ═══');
      saveCombatState(state); renderAllPanels();
      return true;
    }
    return false;
  }

  /* ======================================================================
   * 多动作回合系统 (Multi-Action Turn System)
   * pendingActions队列 — 玩家可执行多个动作，手动结束回合
   * ====================================================================== */
  function addActionToQueue(state, action){
    if(!state.pendingActions)state.pendingActions=[];
    state.pendingActions.push(action);
    saveCombatState(state);
    renderAllPanels();
  }

  async function endTurn(state){
    if(!state.pendingActions||!state.pendingActions.length){
      addLog(state,'没有待执行的行动');
      return;
    }
    var allReports=state.pendingActions.map(function(a){ return a.report; }).join('\n---\n');
    var rpText=state.pendingActions.map(function(a){ return a.rpText||''; }).filter(function(t){return t;}).join('\n');
    state.pendingActions=[];
    state._narrativeText='';
    await executePlayerAction(state, buildReport(state, allReports, rpText, '玩家回合结束'));
  }

  /* ===== 执行玩家行动（同层闭环） ===== */
  async function executePlayerAction(state, report){
    state.phase='AI_GENERATING'; saveCombatState(state); renderAllPanels();
    try{ await appendCombatToLayer(report); }catch(e){ console.error('[战斗引擎v6] 追加战报失败',e); }
    if(checkCombatEnd(state))return;
    var reply;
    try{ reply=await callAI(report); }catch(e){ addLog(state,'AI调用失败: '+(e&&e.message||e)); console.error('[战斗引擎v6] AI调用失败',e); state.phase='PLAYER_ACTING'; saveCombatState(state); renderAllPanels(); return; }
    await processAIReply(state, reply);
  }

  /* ===== 处理AI回复 ===== */
  async function processAIReply(state, reply){
    /* Check for enemy_spawn first */
    var spawns=parseEnemySpawn(reply);
    if(spawns.length){
      spawns.forEach(function(s){
        var en=makeEnemy(s.name,s.hp,s.str,s.agi,s.con,8,8,8);
        calcDerived(en); state.units.push(en);
        addLog(state,'★ 敌方援军: '+s.name+' HP'+s.hp);
      });
    }
    var actions=parseEnemyAction(reply);
    var cleanText=cleanAIReply(reply);
    if(cleanText){ try{ await appendCombatToLayer(cleanText); state._narrativeText=(state._narrativeText||'')+'\n\n'+cleanText; }catch(e){ console.error(e); } }
    if(checkCombatEnd(state))return;
    if(actions.length>0){
      state.phase='ENEMY_RESOLVING'; saveCombatState(state); renderAllPanels();
      var reports=[];
      actions.forEach(function(ea){ var r=resolveEnemyAction(state,ea); if(r)reports.push(r); });
      if(reports.length){ var enemyReport=buildReport(state,'【敌方投点】\n'+reports.join('\n---\n'),'','敌方'); addLog(state,'【敌方行动结算】\n'+reports.join('\n')); try{ await appendCombatToLayer(enemyReport); }catch(e){ console.error(e); } }
    }
    if(checkCombatEnd(state))return;
    tick(state);
    state.phase='PLAYER_ACTING'; saveCombatState(state); renderAllPanels();
  }

  /* ===== 自定义行动 ===== */
  function doCustomAction(state, rpText, rollType){
    var p=state.units.find(function(u){return u.isPlayer;}); if(!p)return;
    var action='';
    if(rollType&&rollType!=='none'&&rollType!==''){ if(p)calcDerived(p); var r=nebDice(rollType,p,'custom'); action='自由投骰: '+rollType+'\n'+r.detail+' = '+r.total+(r.crit?' [大成功]':'')+(r.fumble?' [大失败]':''); }
    var report=buildReport(state,action,rpText,'自定义行动');
    addLog(state,report);
    addActionToQueue(state,{type:'custom',report:action,rpText:rpText});
  }

  /* ===== QR召唤战斗会话（扩展：上下文扫描敌人） ===== */
  async function startCombatSession(enemyName, enemyHp, enemyStr, enemyAgi, enemyCon){
    var d=fetchStatData();
    var state={turn:1,units:[],log:[],phase:'PLAYER_ACTING',active:true,targetIdx:1,combatMessageId:null,pendingActions:[]};
    if(d){ var p=seedPlayer(d); calcDerived(p); state.units.push(p); }
    else{ var p2=makeEnemy('玩家',40,12,12,12,12,12,12); p2.isPlayer=true; p2.id='player'; calcDerived(p2); state.units.push(p2); }
    if(enemyName){ var enemy=makeEnemy(enemyName,enemyHp||30,enemyStr||12,enemyAgi||14,enemyCon||10,8,8,8); calcDerived(enemy); state.units.push(enemy); }
    addLog(state,'-- 战斗开始 · 回合1 --');
    saveCombatState(state);
    var initReport=buildReport(state,'战斗开始！'+state.units.map(function(u){return u.name+' HP'+u.hp+'/'+u.derived.hpMax;}).join(' vs '),'','战斗开始');
    var msgContent='<CombatHud/>\n\n'+initReport;
    try{ if(typeof createChatMessages==='function'){ await createChatMessages([{role:'assistant',message:msgContent}],{refresh:'affected'}); } }catch(e){ console.error('[战斗引擎v6] 创建战斗消息层失败',e); }
    try{ if(typeof getLastMessageId==='function'){ state.combatMessageId=getLastMessageId(); } }catch(e){}
    saveCombatState(state);
  }

  /* ======================================================================
   * 伤害计算管线 (Damage Calculation Pipeline)
   * 基础(装备/技能) + 增伤 + 属性提升(buff roll) + 类型防御 + 暴击 + 特殊
   * ====================================================================== */
  function resolveAttack(att, def, state, options){
    options=options||{};
    var damageType=options.damageType||(att.atkType==='magic'?'魔法':'物理');
    var hitExpr=options.hitExpr||((damageType==='魔法')?'r智力':'r力量');
    var damageExpr=options.damageExpr||'d4+DB';
    var critThreshold=options.critThreshold||20;
    var critMult=options.critMultiplier||2;

    /* Build context for attacker (includes equipment passive buffs) */
    var hit=nebDice(hitExpr, att, 'attack');
    var dodge=nebDice('rd敏捷', def, 'dodge');
    var hitSuccess=hit.total>dodge.total;

    /* Apply attack roll mods from buffs (already in nebDice via context) */
    var dmg=null, dmgDealt=0, hpBefore=def.hp, dmgBreakdown='';

    if(hitSuccess){
      /* Build damage context with all active damage mods */
      var dmgCtx=buildBuffedContext(att, 'damage');
      /* Add equipment triggered effects (增伤) */
      if(options.triggeredEffects){
        options.triggeredEffects.forEach(function(eff){
          if(eff.effect==='roll_mod'&&eff.rollTarget==='damage'){
            damageExpr=damageExpr+'+'+eff.formula;
          }
        });
      }
      /* Add active buff damage mods */
      (att.buffs||[]).forEach(function(b){
        if(b.effect==='roll_mod'&&b.rollTarget==='damage'&&b.turns!==0){
          damageExpr=damageExpr+'+'+b.formula;
        }
      });
      dmg=nebDice(damageExpr, att, 'damage');
      dmgDealt=dmg.total;
      var isCrit=hit.crit||dmg.crit||(hit.total>=critThreshold&&critThreshold<20);
      if(isCrit){ dmgDealt=Math.floor(dmg.total*critMult); }

      /* Apply defense based on damage type */
      if(damageType==='物理'){ dmgDealt=Math.max(1, dmgDealt-def.derived.physDef); }
      else if(damageType==='魔法'){ dmgDealt=Math.max(1, dmgDealt-def.derived.mystDef); }
      /* 真实: no reduction */

      dmgBreakdown='伤害 '+dmg.detail+'='+dmg.total;
      if(isCrit)dmgBreakdown+=' [暴击×'+critMult+'='+dmgDealt+']';
      if(damageType==='物理')dmgBreakdown+=' → 物理减防(-'+def.derived.physDef+')='+dmgDealt;
      else if(damageType==='魔法')dmgBreakdown+=' → 魔法减防(-'+def.derived.mystDef+')='+dmgDealt;
      else dmgBreakdown+=' → 真实伤害(不减)='+dmgDealt;

      def.hp-=dmgDealt; if(def.hp<0)def.hp=0;
    }

    var summary=att.name+'('+damageType+') → '+def.name+'\n'+
      '命中 '+hit.detail+'='+hit.total+(hit.crit?' [大成功]':'')+(hit.fumble?' [大失败]':'')+'\n'+
      '闪避 '+dodge.detail+'='+dodge.total+(dodge.fumble?' [大失败]':'')+'\n'+
      '→ '+(hitSuccess?'命中':'未命中');
    if(hitSuccess&&dmg){ summary+='\n'+dmgBreakdown+'\n'+def.name+' HP '+hpBefore+'→'+def.hp; }
    return {summary:summary,hit:hit,dodge:dodge,dmg:dmg,dmgDealt:dmgDealt,hitSuccess:hitSuccess,target:def,damageType:damageType};
  }

  /* ===== 玩家攻击（使用装备公式） ===== */
  function doPlayerAttack(state, targetIdx, isAOE, aoeRadius, rpText){
    var p=state.units.find(function(u){return u.isPlayer;}); if(!p||p.hp<=0)return;
    var d=fetchStatData();
    var equipCards=d?readEquipmentCards(d):{};
    var weaponName=p.equippedSlots?p.equippedSlots['武器']:null;
    var weapon=weaponName?equipCards[weaponName]:null;

    var hitExpr='r力量', damageExpr='d4+DB', damageType='物理', critThreshold=20, critMult=2;
    var triggeredEffects=[];
    if(weapon){
      if(weapon.伤害)damageExpr=weapon.伤害;
      if(weapon.伤害类型)damageType=weapon.伤害类型;
      critThreshold=20; critMult=2;
      /* Collect triggered effects from weapon */
      weapon._effects.forEach(function(eff){
        if(eff.effect==='roll_mod'&&eff.rollTarget==='damage')triggeredEffects.push(eff);
        if(eff.effect==='debuff_apply')triggeredEffects.push(eff);
      });
    }
    if(p.atkType==='magic'){ hitExpr='r智力'; if(!weapon)damageType='魔法'; }

    var apCost=(p.weaponType==='twohand')?3:2;
    if(p.ap<apCost){ addLog(state,'AP不足（需'+apCost+'）'); return; }

    if(isAOE){
      var targets=unitsInAOE(p,num(aoeRadius,2),state.units.filter(function(u){return !u.isPlayer;}));
      if(!targets.length){ addLog(state,'AOE范围内无目标'); return; }
      var allResults=[];
      targets.forEach(function(def){ var r=resolveAttack(p,def,state,{hitExpr:hitExpr,damageExpr:damageExpr,damageType:damageType,critThreshold:critThreshold,critMultiplier:critMult,triggeredEffects:triggeredEffects}); if(r)allResults.push(r.summary); });
      var hit=nebDice(hitExpr,p,'attack');
      var actionStr='AOE攻击 命中'+hitExpr+'='+hit.total+(hit.crit?'(大成功)':'')+(hit.fumble?'(大失败)':'')+'\n';
      allResults.forEach(function(s){ actionStr+=s+'\n'; });
      costAP(p,apCost);
      actionStr+='消耗'+apCost+'AP/'+(apCost*5)+'HP(耐力)';
      var report=buildReport(state,actionStr,rpText,'AOE攻击');
      addLog(state,report);
      addActionToQueue(state,{type:'aoe',report:actionStr,rpText:rpText});
      return;
    }

    var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer;});
    if(!def||def.hp<=0){ addLog(state,'无有效目标'); return; }
    if(!inRange(p,def,p.weaponType)){ addLog(state,'目标超出射程！距离='+distance(p,def)+'格'); return; }

    var r=resolveAttack(p,def,state,{hitExpr:hitExpr,damageExpr:damageExpr,damageType:damageType,critThreshold:critThreshold,critMultiplier:critMult,triggeredEffects:triggeredEffects});
    costAP(p,apCost);
    var actionStr=r.summary+'\n消耗'+apCost+'AP/'+(apCost*5)+'HP(耐力) | AP→'+p.ap;
    /* Apply debuffs from weapon */
    if(weapon&&r.hitSuccess){
      weapon._effects.forEach(function(eff){
        if(eff.effect==='debuff_apply'){
          if(!def.buffs)def.buffs=[];
          def.buffs.push({name:eff.name,effect:'debuff_apply',formula:eff.formula,turns:eff.duration||2,target:'enemy'});
          actionStr+='\n'+def.name+'获得'+eff.name+'('+eff.duration+'回合)';
        }
      });
    }
    var report=buildReport(state,actionStr,rpText,damageType==='魔法'?'法术攻击':'物理攻击');
    addLog(state,report);
    addActionToQueue(state,{type:'attack',report:actionStr,rpText:rpText});
  }

  /* ===== 闪避/格挡/移动/自由投骰 — 加入pendingActions ===== */
  function doDodge(state, rpText){
    var p=state.units.find(function(u){return u.isPlayer;}); if(!p||p.ap<1){ addLog(state,'AP不足（需1）'); return; }
    var r=nebDice('rd敏捷',p,'dodge'); costAP(p,1);
    var action='玩家闪避 '+r.detail+'='+r.total+(r.crit?' [大成功]':'')+(r.fumble?' [大失败]':'')+'\n消耗1AP/5HP(耐力) | AP→'+p.ap;
    var report=buildReport(state,action,rpText,'闪避'); addLog(state,report);
    addActionToQueue(state,{type:'dodge',report:action,rpText:rpText});
  }
  function doParry(state, ptype, rpText){
    var p=state.units.find(function(u){return u.isPlayer;}); if(!p||p.ap<1){ addLog(state,'AP不足（需1）'); return; }
    var base=Math.floor((num(p.eff['力量'],10)+num(p.eff['敏捷'],10))/2);
    var r=rollDie(base); var crit=(r===base&&base>1),fumble=(r===1&&base>1);
    var threshold={weapon:5,shield2h:5,shield1h:8,barehand:8}[ptype]||5;
    var reduceRate={weapon:0,shield2h:0.4,shield1h:0.2,barehand:0.2}[ptype]||0;
    var label={weapon:'武器格挡',shield2h:'双手盾格挡',shield1h:'单手盾格挡',barehand:'空手格挡'}[ptype]||'格挡';
    costAP(p,1);
    var action='玩家'+label+' [d'+base+'='+r+']'+(crit?' [大成功]':'')+(fumble?' [大失败]':'')+'\n阈值: 格挡值>命中'+threshold+'点→完全格挡；否则减伤'+(reduceRate*100)+'%\n消耗1AP/5HP(耐力) | AP→'+p.ap;
    var report=buildReport(state,action,rpText,label); addLog(state,report);
    addActionToQueue(state,{type:'parry',report:action,rpText:rpText});
  }
  function doMove(state, mode, rpText){
    var p=state.units.find(function(u){return u.isPlayer;}); if(!p)return;
    var apCost=(mode==='run')?2:1; if(p.ap<apCost){ addLog(state,'AP不足（需'+apCost+'）'); return; }
    var spd=Math.floor(num(p.eff['敏捷'],10)/5); var dist=(mode==='run')?spd*3:spd;
    if(mode==='run'){ p.hp-=40; if(p.hp<0)p.hp=0; } costAP(p,apCost);
    var label=(mode==='run')?'跑步':'走路';
    var action='玩家'+label+' 移动'+dist+'米'+(mode==='run'?' (额外消耗40HP)':'')+'\n消耗'+apCost+'AP/'+((apCost*5)+(mode==='run'?40:0))+'HP(耐力) | AP→'+p.ap;
    var report=buildReport(state,action,rpText,label); addLog(state,report);
    addActionToQueue(state,{type:'move',report:action,rpText:rpText});
  }
  function doFreeRoll(state, expr, rpText){
    var p=state.units.find(function(u){return u.isPlayer;}); if(p)calcDerived(p);
    var r=nebDice(expr,p,'custom');
    var action='自由投骰: '+expr+'\n'+r.detail+' = '+r.total+(r.crit?' [大成功]':'')+(r.fumble?' [大失败]':'');
    var report=buildReport(state,action,rpText,'自由投骰'); addLog(state,report);
    appendCombatToLayer(report); renderAllPanels();
  }

  /* ===== Buff/Debuff管理 ===== */
  function addBuff(state, unitIdx, name, turns, target, op, val){
    var u=state.units[unitIdx]; if(!u)return; if(!u.buffs)u.buffs=[];
    u.buffs.push({name:name,turns:turns,target:target,op:op,val:val,effect:'attr_mod',formula:val,flatVal:num(val,0)});
    calcDerived(u); addLog(state,u.name+'获得「'+name+'」('+turns+'回合)'+(target?(' '+op+val+' '+target):'')); saveCombatState(state);
  }
  function removeBuff(state, unitIdx, buffIdx){
    var u=state.units[unitIdx]; if(!u||!u.buffs)return; u.buffs.splice(buffIdx,1); calcDerived(u); saveCombatState(state);
  }
  function adjustHP(state, unitIdx, delta){ var u=state.units[unitIdx]; if(!u)return; u.hp=clamp(u.hp+delta,0,u.derived.hpMax); if(u.hp<=0)addLog(state,u.name+' HP归零！'); saveCombatState(state); }

  /* ===== 技能配置表（兼容localStorage + MVU） ===== */
  function getSkillKey(){ try{ var ctx=(typeof getContext==='function')?getContext():{}; var id=ctx.characterId||ctx.chatId||(ctx.name2||'')||'default'; return 'neb_skills_'+String(id).replace(/[^a-zA-Z0-9_-]/g,'_'); }catch(e){ return 'neb_skills_default'; } }
  function getSkillConfig(){ try{ var s=localStorage.getItem(getSkillKey()); if(s)return JSON.parse(s); }catch(e){} return getDefaultSkills(); }
  function saveSkillConfig(cfg){ try{ localStorage.setItem(getSkillKey(),JSON.stringify(cfg)); }catch(e){} }
  function getDefaultSkills(){ return {
    '强力一击':{name:'强力一击',type:'物理',category:'主动技能',hitBase:0,hitExpr:'r力量',apCost:3,range:2,rangeType:'melee',damage:'d6+DB',cooldown:2,aoeRadius:0,isChanting:false,isInstant:false,buffs:[],debuffs:[],desc:'集中力量进行一次强力攻击。'},
    '火球术':{name:'火球术',type:'法术',category:'主动技能',hitBase:0,hitExpr:'r智力',apCost:3,range:5,rangeType:'ranged',damage:'d6+DB',cooldown:3,aoeRadius:2,isChanting:false,isInstant:false,buffs:[],debuffs:[{name:'灼烧',turns:2,target:'',op:'+',val:'d4',desc:'每回合受到d4伤害'}],desc:'发射火球造成范围伤害并附加灼烧。'},
    '治愈术':{name:'治愈术',type:'法术',category:'主动技能',hitBase:0,hitExpr:'',apCost:3,range:0,rangeType:'self',damage:'',cooldown:2,aoeRadius:0,isChanting:false,isInstant:false,buffs:[{name:'治愈',turns:0,target:'HP',op:'+',val:'d8',desc:'恢复d8点HP'}],debuffs:[],desc:'恢复自身d8点生命值。'},
    '疾风步':{name:'疾风步',type:'辅助',category:'瞬发技能',hitBase:0,hitExpr:'',apCost:1,range:0,rangeType:'self',damage:'',cooldown:3,aoeRadius:0,isChanting:false,isInstant:true,buffs:[{name:'敏捷增幅',turns:2,target:'敏捷',op:'+',val:'10',desc:'敏捷+10持续2回合'}],debuffs:[],desc:'瞬发技能，敏捷+10持续2回合。'}
  }; }

  /* ===== 技能结算（重写：支持MVU卡片格式+多动作回合） ===== */
  function doSkill(state, skillName, targetIdx, rpText){
    var d=fetchStatData();
    var mvuSkills=d?readSkillCards(d):{};
    var skill=mvuSkills[skillName]||getSkillConfig()[skillName];
    if(!skill){ addLog(state,'技能不存在: '+skillName); return; }
    var p=state.units.find(function(u){return u.isPlayer;}); if(!p||p.hp<=0)return;
    if(p.cooldowns&&p.cooldowns[skillName]>0){ addLog(state,'技能'+skillName+'冷却中，剩余'+p.cooldowns[skillName]+'回合'); return; }
    var apCost=num(skill.AP消耗||skill.apCost,2);
    if(p.ap<apCost){ addLog(state,'AP不足（需要'+apCost+'AP）'); return; }
    var energyCost=num(skill.能量消耗,0);
    if(energyCost>0&&p.energy<energyCost){ addLog(state,'能量不足（需要'+energyCost+'）'); return; }

    var effects=skill._effects||[];
    var isBuffSkill=effects.every(function(e){ return e.effect==='attr_mod'||e.effect==='buff_apply'||e.effect==='roll_mod'||e.effect==='special'; }) && effects.some(function(e){ return e.effect==='attr_mod'||e.effect==='buff_apply'||e.effect==='roll_mod'; }) && !(skill.伤害);

    var actionStr='玩家使用技能: '+skillName+'\n';
    var isSelf=(String(skill.范围||skill.rangeType||'').indexOf('self')>=0||String(skill.范围||'').indexOf('自身')>=0);
    var targets=[];

    if(isSelf){ targets=[p]; }
    else{
      var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer&&u.hp>0;});
      if(!def){ addLog(state,'无有效目标'); return; }
      targets=[def];
    }

    /* Hit roll */
    var hit=null;
    var hitExpr=skill.hitExpr||'';
    if(!hitExpr && skill.伤害){ hitExpr=(String(skill.伤害类型||'物理')==='魔法')?'r智力':'r力量'; }
    if(hitExpr){ hit=nebDice(hitExpr,p,'attack'); actionStr+='命中 '+hit.detail+'='+hit.total+(hit.crit?' [大成功]':'')+(hit.fumble?' [大失败]':'')+'\n'; }

    targets.forEach(function(def){
      if(hitExpr&&!isSelf){
        var dodge=nebDice('rd敏捷',def,'dodge');
        var hitSuccess=hit.total>dodge.total;
        actionStr+=def.name+'闪避 '+dodge.detail+'='+dodge.total+(dodge.fumble?' [大失败]':'')+'\n→ '+(hitSuccess?'命中':'未命中')+'\n';
        if(hitSuccess&&skill.伤害){
          var dmgType=skill.伤害类型||'物理';
          var dmg=nebDice(skill.伤害,p,'damage');
          var dmgDealt=dmg.total;
          if(dmg.crit||hit.crit)dmgDealt=dmg.total*2;
          /* Apply defense by type */
          if(dmgType==='物理')dmgDealt=Math.max(1,dmgDealt-def.derived.physDef);
          else if(dmgType==='魔法')dmgDealt=Math.max(1,dmgDealt-def.derived.mystDef);
          actionStr+='伤害 '+dmg.detail+'='+dmg.total+(dmg.crit?' [暴击翻倍='+dmgDealt+']':'')+' → '+dmgType;
          if(dmgType!=='真实')actionStr+='(减防→'+dmgDealt+')';
          actionStr+='\n'+def.name+' HP '+def.hp+'→'+Math.max(0,def.hp-dmgDealt)+'\n';
          def.hp-=dmgDealt; if(def.hp<0)def.hp=0;
        }
      }
      /* Apply effects */
      effects.forEach(function(eff){
        if(eff.effect==='debuff_apply'&&!isSelf){
          if(!def.buffs)def.buffs=[];
          def.buffs.push({name:eff.name,effect:'debuff_apply',formula:eff.formula,turns:eff.duration||2,target:'enemy'});
          actionStr+=def.name+'获得'+eff.name+'('+eff.duration+'回合)\n';
        }
        if(eff.effect==='buff_apply'){
          if(!p.buffs)p.buffs=[];
          if(eff.target==='HP'&&eff.op==='+'){
            var heal=nebDice(eff.formula,p,'heal');
            p.hp=clamp(p.hp+heal.total,0,p.derived.hpMax);
            actionStr+='恢复HP '+heal.detail+'='+heal.total+' → HP '+p.hp+'\n';
          } else {
            p.buffs.push({name:eff.name,effect:'attr_mod',target:eff.target||'',op:eff.op||'+',formula:eff.formula,flatVal:0,turns:eff.duration||3});
            actionStr+='获得'+eff.name+'('+eff.duration+'回合)\n';
          }
        }
        if(eff.effect==='attr_mod'){
          if(!p.buffs)p.buffs=[];
          p.buffs.push({name:skillName+':'+eff.target,effect:'attr_mod',target:eff.target,op:eff.op||'+',formula:eff.formula,flatVal:0,turns:eff.duration||3});
          actionStr+='获得'+eff.target+eff.op+eff.formula+'('+(eff.duration||3)+'回合)\n';
        }
        if(eff.effect==='roll_mod'){
          if(!p.buffs)p.buffs=[];
          p.buffs.push({name:skillName+':'+eff.rollTarget,effect:'roll_mod',rollTarget:eff.rollTarget,formula:eff.formula,turns:eff.duration||3});
          actionStr+='获得'+eff.rollTarget+'+'+eff.formula+'('+(eff.duration||3)+'回合)\n';
        }
      });
    });

    p.ap-=apCost; p.hp-=apCost*5; if(p.hp<0)p.hp=0;
    if(energyCost>0){ p.energy-=energyCost; if(p.energy<0)p.energy=0; }
    if(!p.cooldowns)p.cooldowns={};
    var cd=num(skill.冷却||skill.cooldown,0); if(cd>0)p.cooldowns[skillName]=cd;
    calcDerived(p);
    actionStr+='消耗'+apCost+'AP/'+(apCost*5)+'HP(耐力)'+(energyCost>0?'/'+energyCost+'能量':'')+' | AP→'+p.ap;
    if(cd>0)actionStr+=' | 冷却:'+cd+'回合';
    var report=buildReport(state,actionStr,rpText,'技能:'+skillName);
    addLog(state,report);
    /* Buff-only skills: add to pendingActions, no AI trigger */
    if(isBuffSkill){ addActionToQueue(state,{type:'buff',skill:skillName,report:actionStr,rpText:rpText}); }
    else { addActionToQueue(state,{type:'skill',skill:skillName,report:actionStr,rpText:rpText}); }
  }

  /* ===== 消耗品使用 ===== */
  function doUseConsumable(state, itemName, rpText){
    var d=fetchStatData(); if(!d){ addLog(state,'无法读取数据'); return; }
    var consumables=readConsumableCards(d);
    var item=consumables[itemName]; if(!item){ addLog(state,'物品不存在: '+itemName); return; }
    if(item.数量<=0){ addLog(state,itemName+' 数量不足'); return; }
    var p=state.units.find(function(u){return u.isPlayer;}); if(!p)return;
    var effect=item.使用效果;
    var actionStr='玩家使用: '+itemName+'\n';
    /* Parse effect: HP+d8, 能量+d5, etc. */
    var healMatch=effect.match(/HP\s*[++]\s*(.+)/i);
    var energyMatch=effect.match(/能量\s*[++]\s*(.+)/i);
    if(healMatch){
      var heal=nebDice(healMatch[1],p,'heal');
      p.hp=clamp(p.hp+heal.total,0,p.derived.hpMax);
      actionStr+='恢复HP '+heal.detail+'='+heal.total+' → HP '+p.hp+'\n';
    }
    if(energyMatch){
      var en=nebDice(energyMatch[1],p,'energy');
      p.energy=clamp(p.energy+en.total,0,p.derived.energyMax);
      actionStr+='恢复能量 '+en.detail+'='+en.total+' → 能量'+p.energy+'\n';
    }
    if(!healMatch&&!energyMatch){
      /* Other effects — pass to AI */
      actionStr+='效果: '+effect+'\n';
    }
    item.数量--; /* Frontend temp display */
    actionStr+='剩余: '+item.数量+'个';
    var report=buildReport(state,actionStr,rpText,'使用:'+itemName);
    addLog(state,report);
    addActionToQueue(state,{type:'item',item:itemName,report:actionStr,rpText:rpText,consumableEffect:effect});
  }

  /* ===== 反击/双持/投掷 — 加入pendingActions ===== */
  function doCounter(state, targetIdx, rpText){
    var p=state.units.find(function(u){return u.isPlayer;}); if(!p||p.ap<1){ addLog(state,'AP不足（反击需要1AP）'); return; }
    var r=nebDice('r力量',p,'attack'); p.ap-=1; p.hp-=5; if(p.hp<0)p.hp=0;
    var action='玩家反击！放弃闪避，消耗1AP进行反击攻击\n反击命中 r力量='+r.detail+'='+r.total+(r.crit?' [大成功]':'')+(r.fumble?' [大失败]':'')+'\n消耗1AP/5HP(耐力) | AP→'+p.ap;
    var report=buildReport(state,action,rpText,'反击'); addLog(state,report);
    addActionToQueue(state,{type:'counter',report:action,rpText:rpText});
  }
  function doDualWield(state, targetIdx, rpText){
    var p=state.units.find(function(u){return u.isPlayer;}); if(!p||p.hp<=0)return; if(p.ap<4){ addLog(state,'双持攻击需要4AP'); return; }
    var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer&&u.hp>0;}); if(!def){ addLog(state,'无有效目标'); return; }
    var mainHit=nebDice('r力量',p,'attack');
    var hitPen=rollDie(10); var dmgPen=rollDie(5);
    var offHitTotal=mainHit.total-hitPen;
    var dodge=nebDice('rd敏捷',def,'dodge');
    var action='玩家双持攻击 → '+def.name+'\n主手命中 r力量='+mainHit.detail+'='+mainHit.total+'\n副手命中(主手-d10) '+mainHit.total+'-d10='+hitPen+'='+offHitTotal+'\n'+def.name+'闪避 rd敏捷='+dodge.detail+'='+dodge.total+'\n';
    var mainSuccess=mainHit.total>dodge.total, offSuccess=offHitTotal>dodge.total;
    action+='主手→ '+(mainSuccess?'命中':'未命中')+' | 副手→ '+(offSuccess?'命中':'未命中')+'\n';
    var totalDmg=0;
    if(mainSuccess){ var d1=nebDice('d4+DB',p,'damage'); totalDmg+=d1.total; action+='主手伤害 '+d1.detail+'='+d1.total+'\n'; }
    if(offSuccess){ var d2=nebDice('d4+DB',p,'damage'); var offDmg=Math.max(0,d2.total-dmgPen); totalDmg+=offDmg; action+='副手伤害 '+d2.detail+'='+d2.total+'-d5='+dmgPen+'='+offDmg+'\n'; }
    if(totalDmg>0){ def.hp-=totalDmg; if(def.hp<0)def.hp=0; action+=def.name+' HP '+def.hp+'\n'; }
    p.ap-=4; p.hp-=20; if(p.hp<0)p.hp=0;
    action+='消耗4AP/20HP(耐力) | AP→'+p.ap;
    var report=buildReport(state,action,rpText,'双持攻击'); addLog(state,report);
    addActionToQueue(state,{type:'dualwield',report:action,rpText:rpText});
  }
  function doThrow(state, targetIdx, rpText){
    var p=state.units.find(function(u){return u.isPlayer;}); if(!p||p.hp<=0)return; if(p.ap<2){ addLog(state,'投掷需要2AP'); return; }
    var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer&&u.hp>0;}); if(!def){ addLog(state,'无有效目标'); return; }
    var str=num(p.eff?p.eff['力量']:p.attrs['力量'],10);
    var dist=distance(p,def); if(dist>str){ addLog(state,'超出投掷距离！距离='+dist+'格，最大='+str+'格'); return; }
    var halfStr=Math.floor(str/2); if(halfStr<1)halfStr=1;
    var throwRoll=rollDie(halfStr);
    var dodge=nebDice('rd敏捷',def,'dodge');
    var hitSuccess=throwRoll>dodge.total;
    var action='玩家投掷攻击 → '+def.name+' (距离'+dist+'格/最大'+str+'格)\n投掷命中 d'+halfStr+'='+throwRoll+'\n'+def.name+'闪避 rd敏捷='+dodge.detail+'='+dodge.total+'\n→ '+(hitSuccess?'命中':'未命中')+'\n';
    if(hitSuccess){ var dmg=nebDice('d4+DB',p,'damage'); def.hp-=dmg.total; if(def.hp<0)def.hp=0; action+='伤害 '+dmg.detail+'='+dmg.total+'\n'+def.name+' HP '+def.hp; }
    p.ap-=2; p.hp-=10; if(p.hp<0)p.hp=0;
    action+='\n消耗2AP/10HP(耐力) | AP→'+p.ap;
    var report=buildReport(state,action,rpText,'投掷攻击'); addLog(state,report);
    addActionToQueue(state,{type:'throw',report:action,rpText:rpText});
  }

  /* ===== 敌方行动解析 ===== */
  function parseEnemyAction(text){
    var results=[]; var regex=/<enemy_action>\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^<]*?)\s*<\/enemy_action>/gi; var m;
    while((m=regex.exec(text))!==null){ results.push({actor:m[1].trim(),action:m[2].trim(),target:m[3].trim(),param:m[4].trim()}); }
    var regex2=/<enemy_action>\s*([^|]+?)\s*\|\s*([^|<]+?)\s*<\/enemy_action>/gi;
    while((m=regex2.exec(text))!==null){ results.push({actor:m[1].trim(),action:m[2].trim(),target:'',param:''}); }
    return results;
  }
  function resolveEnemyAction(state, ea){
    var actor=state.units.find(function(u){return u.name===ea.actor||u.id===ea.actor;});
    if(!actor||actor.hp<=0)return '敌方'+ea.actor+'无法行动(不存在或已倒下)';
    var target=state.units.find(function(u){return u.name===ea.target||u.id===ea.target;});
    if(!target)target=state.units.find(function(u){return u.isPlayer;});
    if(ea.action==='攻击'){
      var r=resolveAttack(actor,target,state,{});
      var apCost=(actor.weaponType==='twohand')?3:2; costAP(actor,apCost);
      addLog(state,r.summary+'\n'+actor.name+'消耗'+apCost+'AP');
      return r.summary+'\n'+actor.name+'消耗'+apCost+'AP/'+(apCost*5)+'HP(耐力)';
    }
    if(ea.action==='闪避'){ var dr=nebDice('rd敏捷',actor,'dodge'); costAP(actor,1); addLog(state,actor.name+'闪避 '+dr.detail+'='+dr.total); return actor.name+'闪避='+dr.total+(dr.crit?'(大成功)':'')+(dr.fumble?'(大失败)':'')+'\n消耗1AP/5HP(耐力)'; }
    if(ea.action==='移动'){ var coords=ea.param.split(','); if(coords.length>=2){ actor.x=parseInt(coords[0],10)||actor.x; actor.y=parseInt(coords[1],10)||actor.y; } costAP(actor,1); addLog(state,actor.name+'移动到('+actor.x+','+actor.y+')'); return actor.name+'移动到('+actor.x+','+actor.y+')'; }
    if(ea.action==='防御'||ea.action==='等待'){ addLog(state,actor.name+'选择防御'); return actor.name+'选择防御姿态'; }
    if(ea.action==='逃跑'){ addLog(state,actor.name+'试图逃跑'); return actor.name+'试图逃跑'; }
    return actor.name+'执行:'+ea.action;
  }

  /* ===== 敌人生成解析 ===== */
  function parseEnemySpawn(text){
    var results=[];
    var regex=/<enemy_spawn>\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^<]*?)\s*<\/enemy_spawn>/gi;
    var m;
    while((m=regex.exec(text))!==null){
      results.push({name:m[1].trim(),hp:parseInt(m[2].trim(),10)||30,str:parseInt(m[3].trim(),10)||12,agi:parseInt(m[4].trim(),10)||14,con:parseInt(m[5].trim(),10)||10});
    }
    /* Fallback: 2-field */
    var regex2=/<enemy_spawn>\s*([^|]+?)\s*\|\s*([^<]+?)\s*<\/enemy_spawn>/gi;
    while((m=regex2.exec(text))!==null){
      results.push({name:m[1].trim(),hp:parseInt(m[2].trim(),10)||30,str:12,agi:14,con:10});
    }
    return results;
  }

  /* ===== 技能注册（兼容<skill_register>） ===== */
  function parseSkillRegister(text){
    var results=[]; var regex=/<skill_register>\s*([\s\S]*?)\s*<\/skill_register>/gi; var m;
    while((m=regex.exec(text))!==null){ try{ results.push(JSON.parse(m[1].trim())); }catch(e){ console.warn('[战斗引擎v6] skill_register JSON解析失败',e); } }
    return results;
  }
  function registerSkill(skillData){
    if(!skillData||!skillData.name)return false;
    var cfg=getSkillConfig(); var isNew=!cfg[skillData.name];
    cfg[skillData.name]=skillData; saveSkillConfig(cfg);
    console.log('[战斗引擎v6] 技能'+(isNew?'注册':'更新')+': '+skillData.name);
    return isNew;
  }
  function checkSkillRegister(){
    try{
      var msgs=getChatMessages('0-{{lastMessageId}}'); if(!msgs||!msgs.length)return;
      var lastMsg=msgs[msgs.length-1]; var text=lastMsg.message||lastMsg.mes||'';
      var skills=parseSkillRegister(text); if(skills.length===0)return;
      var state=getCombatState();
      skills.forEach(function(sd){ var isNew=registerSkill(sd); if(state&&state.active){ addLog(state,(isNew?'★ 新技能注册':'技能更新')+': '+sd.name); } });
      if(state&&state.active){ saveCombatState(state); renderAllPanels(); }
    }catch(e){ console.error('[战斗引擎v6] 技能注册检查失败',e); }
  }
  function checkEnemySpawn(){
    try{
      var msgs=getChatMessages('0-{{lastMessageId}}'); if(!msgs||!msgs.length)return;
      var state=getCombatState(); if(!state||!state.active)return;
      var lastMsg=msgs[msgs.length-1]; var text=lastMsg.message||lastMsg.mes||'';
      var spawns=parseEnemySpawn(text); if(spawns.length===0)return;
      spawns.forEach(function(s){ var en=makeEnemy(s.name,s.hp,s.str,s.agi,s.con,8,8,8); calcDerived(en); state.units.push(en); addLog(state,'★ 敌方援军加入: '+s.name+' HP'+s.hp); });
      saveCombatState(state); renderAllPanels();
    }catch(e){ console.error('[战斗引擎v6] 敌人生成检查失败',e); }
  }
  function syncSkillsFromStatData(data){
    if(!data)return; var rawSkills=getValue(data,'个人档案.强化与技能.技能列表',null); if(!rawSkills||typeof rawSkills!=='object')return;
    var cfg=getSkillConfig(); var changed=false;
    Object.keys(rawSkills).forEach(function(name){ if(!cfg[name]){ var s=rawSkills[name]; cfg[name]={name:name,type:'物理',category:'主动技能',hitBase:0,hitExpr:'',apCost:3,range:2,rangeType:'melee',damage:'d4+DB',cooldown:0,aoeRadius:0,isChanting:false,isInstant:false,buffs:[],debuffs:[],desc:getValue(s,'描述','')||''}; changed=true; } });
    if(changed){ saveSkillConfig(cfg); console.log('[战斗引擎v6] 从stat_data同步新技能'); }
  }

  /* ======================================================================
   * UI 渲染 (6标签: 战场/正文/技能/装备/道具/日志)
   * CSS风格与现有状态栏(#nebula-hud)和战斗控制台(#combat-hud)保持一致
   * ====================================================================== */
  function bar(pct,cls,idPrefix){ pct=clamp(pct,0,100); return '<div class="'+idPrefix+'-bar-track"><i class="'+idPrefix+'-bar-fill '+cls+'" style="width:'+pct+'%"></i></div>'; }
  function apDots(cur,max,idPrefix){ var h=''; for(var i=0;i<max;i++){ h+='<span class="'+idPrefix+'-ap-dot'+(i<cur?' on':'')+'"></span>'; } return h; }
  var state_targetIdx=1;
  var state_activeTab='battlefield';

  function renderUnit(u, idx, idPrefix){
    calcDerived(u);
    var hpPct=u.derived.hpMax>0?(u.hp/u.derived.hpMax*100):0;
    var enPct=u.derived.energyMax>0?(u.energy/u.derived.energyMax*100):0;
    var cls=u.isPlayer?'player':'enemy';
    var h='<div class="'+idPrefix+'-unit '+cls+'" data-u="'+idx+'">'+
      '<div class="'+idPrefix+'-unit-head"><span class="'+idPrefix+'-unit-name">'+esc(u.name)+'</span><span class="'+idPrefix+'-unit-tag">'+(u.isPlayer?'玩家':'敌人')+' ('+u.x+','+u.y+')</span></div>';
    h+='<div class="'+idPrefix+'-bar-line"><span class="'+idPrefix+'-bar-label">HP</span>'+bar(hpPct,hpPct<30?'hp low':'hp',idPrefix)+'<span class="'+idPrefix+'-bar-val">'+u.hp+'/'+u.derived.hpMax+'<span class="'+idPrefix+'-hp-ctrl"><button data-hp="'+idx+'" data-d="-5">-</button><button data-hp="'+idx+'" data-d="5">+</button></span></span></div>';
    if(u.derived.energyMax>0){ h+='<div class="'+idPrefix+'-bar-line"><span class="'+idPrefix+'-bar-label">'+esc((u.energyType||'能量').slice(0,2))+'</span>'+bar(enPct,'energy',idPrefix)+'<span class="'+idPrefix+'-bar-val">'+u.energy+'/'+u.derived.energyMax+'</span></div>'; }
    h+='<div class="'+idPrefix+'-ap-row"><span class="'+idPrefix+'-ap-label">AP</span>'+apDots(u.ap,u.derived.apMax,idPrefix)+'<span class="'+idPrefix+'-ap-info">'+u.ap+'/'+u.derived.apMax+'</span></div>';
    /* Equipment slots for player */
    if(u.isPlayer&&u.equippedSlots){
      h+='<div class="'+idPrefix+'-equip-slots">';
      ['武器','副手','防具','饰品'].forEach(function(slot){
        var name=u.equippedSlots[slot]||'';
        h+='<div class="'+idPrefix+'-equip-slot'+(name?'':' empty')+'"><span class="slot-name">'+slot+'</span><span class="slot-item">'+esc(name||'空')+'</span></div>';
      });
      h+='</div>';
    }
    h+='<div class="'+idPrefix+'-attrs">';
    ATTRS.forEach(function(a){ var base=num(u.attrs[a],10),eff=num(u.eff[a],10); var bcls=''; if(eff>base)bcls='buffed'; else if(eff<base)bcls='debuffed'; h+='<div class="'+idPrefix+'-attr-chip '+bcls+'"><span class="n">'+a+'</span><span class="v">'+eff+(eff!==base?' ('+base+')':'')+'</span></div>'; });
    h+='</div>';
    h+='<div class="'+idPrefix+'-derived"><div class="'+idPrefix+'-derived-chip"><span class="n">物防</span><span class="v">'+u.derived.physDef+'</span></div><div class="'+idPrefix+'-derived-chip"><span class="n">神防</span><span class="v">'+u.derived.mystDef+'</span></div><div class="'+idPrefix+'-derived-chip"><span class="n">暴击</span><span class="v">'+u.derived.critRate+'%</span></div><div class="'+idPrefix+'-derived-chip"><span class="n">移速</span><span class="v">'+u.derived.moveSpeed+'m</span></div></div>';
    if(u.buffs&&u.buffs.length){
      h+='<div class="'+idPrefix+'-buffs">';
      u.buffs.forEach(function(b,bi){
        if(b.turns===-1)return; /* Skip permanent equipment buffs in display */
        var isDeb=(b.op==='+'&&num(b.flatVal||b.val,0)<0)||b.effect==='debuff_apply';
        var chip=isDeb?idPrefix+'-chip-debuff':idPrefix+'-chip-buff';
        var lbl=b.name+' ('+b.turns+'回合)'; if(b.target&&b.op&&b.val)lbl+=' ['+b.op+b.val+' '+b.target+']'; if(b.effect==='roll_mod')lbl='['+b.rollTarget+'+'+b.formula+'] '+(b.turns>0?b.turns+'回合':'');
        h+='<span class="'+chip+'" data-buff="'+idx+'" data-bi="'+bi+'" title="点击移除">'+esc(lbl)+'</span>';
      });
      h+='</div>';
    }
    var cds=Object.keys(u.cooldowns||{}).filter(function(k){ return u.cooldowns[k]>0; });
    if(cds.length){ h+='<div class="'+idPrefix+'-buffs">'; cds.forEach(function(k){ h+='<span class="'+idPrefix+'-chip-cooldown">'+esc(k)+' CD:'+u.cooldowns[k]+'</span>'; }); h+='</div>'; }
    if(!u.isPlayer){ h+='<div style="margin-top:6px"><button class="'+idPrefix+'-btn '+(idx===state_targetIdx?idPrefix+'-btn-primary':'')+'" data-target="'+idx+'" style="font-size:10px;padding:3px 8px">'+(idx===state_targetIdx?'当前目标':'设为目标')+'</button></div>'; }
    h+='</div>';
    return h;
  }

  function renderActions(u, idPrefix){
    if(!u)return'';
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
    /* 技能快捷栏 — 从MVU读取 */
    var d=fetchStatData();
    var mvuSkills=d?readSkillCards(d):{};
    var localSkills=getSkillConfig();
    var allSkillNames=Object.keys(mvuSkills); Object.keys(localSkills).forEach(function(n){ if(allSkillNames.indexOf(n)<0)allSkillNames.push(n); });
    if(allSkillNames.length){
      h+='<div class="'+idPrefix+'-section" style="background:rgba(255,255,255,0.55);border:1px solid rgba(255,255,255,0.7);border-radius:14px;padding:12px;margin-bottom:10px;">';
      h+='<div style="font-size:12px;color:#6b6488;margin-bottom:6px;font-weight:600;">技能（点击使用，加入行动队列）</div>';
      h+='<div style="display:flex;flex-wrap:wrap;gap:6px;">';
      allSkillNames.forEach(function(name){
        var s=mvuSkills[name]||localSkills[name]; if(!s)return;
        var apCost=num(s.AP消耗||s.apCost,2);
        var energyCost=num(s.能量消耗,0);
        var onCD=u.cooldowns&&u.cooldowns[name]>0;
        var cdTxt=onCD?' (CD:'+u.cooldowns[name]+')':'';
        var style=onCD?'opacity:0.4;cursor:not-allowed;':'cursor:pointer;';
        var label=esc(name)+'<span style="font-size:9px;color:#ed8936;margin-left:4px;">'+apCost+'AP'+(energyCost>0?'/'+energyCost+'能量':'')+esc(cdTxt)+'</span>';
        h+='<button class="'+idPrefix+'-act-btn" data-skill="'+esc(name)+'" style="'+style+'"'+(onCD?'disabled':'')+'>'+label+'</button>';
      });
      h+='</div></div>';
    }
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
    var data=fetchStatData(); if(data)syncSkillsFromStatData(data);
    var p=state.units.find(function(u){return u.isPlayer;});
    if(!p&&data){ p=seedPlayer(data); state.units.push(p); calcDerived(p); saveCombatState(state); }
    if(p&&data){ ATTRS.forEach(function(k){ p.attrs[k]=getValue(data,'个人档案.战斗属性.'+k,p.attrs[k]); }); var hpMaxNew=getValue(data,'个人档案.衍生属性.生命值.最大',0); if(hpMaxNew&&hpMaxNew>0)p.hpMaxBase=hpMaxNew; p.energyType=getValue(data,'个人档案.衍生属性.能量值.类型',p.energyType); calcDerived(p); }

    var phaseLabel={IDLE:'未开始',PLAYER_ACTING:'🟠 等待玩家行动',AI_GENERATING:'🔴 AI演绎中...',ENEMY_RESOLVING:'🟡 敌方结算中...',COMBAT_END:'⚔ 战斗结束'}[state.phase]||state.phase;
    var phaseColor={IDLE:'#6b6488',PLAYER_ACTING:'#48bb78',AI_GENERATING:'#e53e3e',ENEMY_RESOLVING:'#d69e2e',COMBAT_END:'#a78bfa'}[state.phase]||'#6b6488';

    /* Header with tabs */
    var h='<div class="'+idPrefix+'-console">'+
      '<div class="'+idPrefix+'-topbar">'+
        '<div class="'+idPrefix+'-topbar-title">⚔ 战斗控制台 <span class="'+idPrefix+'-turn-badge">回合'+state.turn+'</span> <span class="'+idPrefix+'-phase-badge" style="color:'+phaseColor+';-webkit-text-fill-color:'+phaseColor+';">'+esc(phaseLabel)+'</span></div>'+
        '<div class="'+idPrefix+'-topbar-btns">'+
          '<button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary" data-act="addbuff">施加状态</button>'+
          '<button class="'+idPrefix+'-btn '+idPrefix+'-btn-danger" data-act="endcombat">结束战斗</button>'+
        '</div>'+
      '</div>';
    /* Tab navigation */
    h+='<div class="'+idPrefix+'-tabs">';
    var tabs=[{id:'battlefield',label:'战场'},{id:'narrative',label:'正文'},{id:'skills',label:'技能'},{id:'equipment',label:'装备'},{id:'items',label:'道具'},{id:'log',label:'日志'}];
    tabs.forEach(function(t){ h+='<div class="'+idPrefix+'-tab'+(state_activeTab===t.id?' active':'')+'" data-tab="'+t.id+'">'+t.label+'</div>'; });
    h+='</div>';
    h+='<div class="'+idPrefix+'-body">';

    /* === 战场标签 === */
    if(state_activeTab==='battlefield'){
      h+='<div class="'+idPrefix+'-page active" id="page-battlefield">';
      h+='<div class="'+idPrefix+'-unit-grid">';
      state.units.forEach(function(u,i){ h+=renderUnit(u,i,idPrefix); });
      h+='</div>';
      var activeUnit=state.units[0]||p;
      if(state.phase==='PLAYER_ACTING')h+=renderActions(activeUnit,idPrefix);
      else if(state.phase==='AI_GENERATING')h+='<div class="'+idPrefix+'-empty">⏳ AI正在演绎战斗...请稍候</div>';
      else if(state.phase==='ENEMY_RESOLVING')h+='<div class="'+idPrefix+'-empty">⏳ 敌方行动结算中...</div>';
      else if(state.phase==='COMBAT_END')h+='<div class="'+idPrefix+'-empty" style="color:#a78bfa;">⚔ 战斗已结束</div>';
      else h+='<div class="'+idPrefix+'-empty">战斗未开始</div>';
      /* Add enemy form when IDLE */
      if(state.phase==='IDLE'||!state.active){
        h+='<div class="'+idPrefix+'-section"><div class="'+idPrefix+'-section-title">添加敌人后开始战斗</div><div class="'+idPrefix+'-add-enemy-row"><div class="'+idPrefix+'-add-enemy-field"><label>名称</label><input class="wide" id="'+idPrefix+'-en-name" value="哥布林"></div><div class="'+idPrefix+'-add-enemy-field"><label>HP</label><input id="'+idPrefix+'-en-hp" value="30"></div><div class="'+idPrefix+'-add-enemy-field"><label>力量</label><input id="'+idPrefix+'-en-str" value="12"></div><div class="'+idPrefix+'-add-enemy-field"><label>敏捷</label><input id="'+idPrefix+'-en-agi" value="14"></div><div class="'+idPrefix+'-add-enemy-field"><label>体质</label><input id="'+idPrefix+'-en-con" value="10"></div><button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary" data-act="addenemy">添加</button><button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary" data-act="startcombat">开始战斗</button></div></div>';
      }
      /* Dice tray */
      h+='<div class="'+idPrefix+'-section"><div class="'+idPrefix+'-section-title">投骰台（r力量 / rd敏捷 / d20 / 3d6 / d4+DB / 取低 / 取高）</div><div class="'+idPrefix+'-dice-input"><input id="'+idPrefix+'-dice-expr" placeholder="例如：r力量 或 d20+5"><button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary" data-act="freeroll">投骰</button></div><div class="'+idPrefix+'-dice-quick"><button data-quick="r力量">r力量</button><button data-quick="rd敏捷">rd敏捷</button><button data-quick="r智力">r智力</button><button data-quick="d20">d20</button><button data-quick="d100">d100</button><button data-quick="3d6">3d6</button><button data-quick="d4+DB">d4+DB</button></div></div>';
      /* Pending actions queue + End Turn */
      if(state.pendingActions&&state.pendingActions.length){
        h+='<div class="'+idPrefix+'-section '+idPrefix+'-pending-section"><div class="'+idPrefix+'-section-title">待执行行动队列</div>';
        state.pendingActions.forEach(function(pa,i){
          h+='<div class="'+idPrefix+'-pending-action"><span class="pa-idx">'+(i+1)+'.</span><span class="pa-type">'+esc(pa.type)+'</span><span class="pa-summary">'+esc((pa.report||'').substring(0,60))+'</span><button class="pa-remove" data-act="removepending" data-pidx="'+i+'">×</button></div>';
        });
        h+='<button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary '+idPrefix+'-end-turn-btn" data-act="endturn">结束回合 → 发送给AI</button>';
        h+='</div>';
      } else if(state.phase==='PLAYER_ACTING'){
        h+='<div class="'+idPrefix+'-section '+idPrefix+'-pending-section"><div class="'+idPrefix+'-empty" style="padding:8px;">行动队列为空。执行技能或攻击后，点击"结束回合"发送给AI。</div></div>';
      }
      h+='</div>';
    }

    /* === 正文标签 === */
    if(state_activeTab==='narrative'){
      h+='<div class="'+idPrefix+'-page active" id="page-narrative">';
      var narr=state._narrativeText||'';
      if(narr){ h+='<div class="'+idPrefix+'-narrative">'+esc(narr)+'</div>'; }
      else{ h+='<div class="'+idPrefix+'-empty">暂无AI演绎文本。战斗开始后，AI的演绎将显示在这里。</div>'; }
      h+='</div>';
    }

    /* === 技能标签 === */
    if(state_activeTab==='skills'){
      h+='<div class="'+idPrefix+'-page active" id="page-skills">';
      var d2=fetchStatData(); var skills=d2?readSkillCards(d2):{}; var localS=getSkillConfig();
      var allNames=Object.keys(skills); Object.keys(localS).forEach(function(n){ if(allNames.indexOf(n)<0)allNames.push(n); });
      if(allNames.length){
        h+='<div class="'+idPrefix+'-card-grid">';
        allNames.forEach(function(name){
          var s=skills[name]||localS[name]; if(!s)return;
          var apCost=num(s.AP消耗||s.apCost,2);
          var energyCost=num(s.能量消耗,0);
          var dmgType=s.伤害类型||s.type||'物理';
          h+='<div class="'+idPrefix+'-skill-card" data-skill-detail="'+esc(name)+'">';
          h+='<div class="card-header"><span class="card-name">'+esc(name)+'</span><span class="card-badge '+dmgType+'">'+dmgType+'</span></div>';
          h+='<div class="card-info"><span>动作:'+(s.动作类型||s.category||'主动')+'</span><span>AP:'+apCost+'</span>'+(energyCost>0?'<span>能量:'+energyCost+'</span>':'')+(s.冷却||s.cooldown?'<span>CD:'+(s.冷却||s.cooldown)+'</span>':'')+'</div>';
          if(s.伤害)h+='<div class="card-damage">伤害: '+esc(s.伤害)+'</div>';
          if(s.描述||s.desc)h+='<div class="card-desc">'+esc(s.描述||s.desc)+'</div>';
          var effs=s._effects||(s.buffs?[]:[]);
          if(effs.length){ h+='<div class="card-effects">'; effs.forEach(function(e){ h+='<span class="effect-tag">'+esc(e.effect+':'+(e.target||e.rollTarget||'')+'+'+esc(e.formula||''))+'</span>'; }); h+='</div>'; }
          h+='</div>';
        });
        h+='</div>';
      } else { h+='<div class="'+idPrefix+'-empty">暂无技能。AI将在剧情中注册技能。</div>'; }
      h+='</div>';
    }

    /* === 装备标签 === */
    if(state_activeTab==='equipment'){
      h+='<div class="'+idPrefix+'-page active" id="page-equipment">';
      var d3=fetchStatData();
      if(d3){
        var equipCards=readEquipmentCards(d3);
        var slots=getEquippedSlots(d3);
        /* Equipment slots */
        h+='<div class="'+idPrefix+'-equip-section"><div class="'+idPrefix+'-section-title">装备槽</div><div class="'+idPrefix+'-equip-grid">';
        ['武器','副手','防具','饰品'].forEach(function(slot){
          var name=slots[slot]||'';
          var card=name?equipCards[name]:null;
          h+='<div class="'+idPrefix+'-equip-card'+(card?'':' empty')+'"><div class="slot-label">'+slot+'</div>';
          if(card){ h+='<div class="card-name">'+esc(card.name)+'</div>'; if(card.伤害)h+='<div class="card-dmg">伤害: '+esc(card.伤害)+'</div>'; if(card.护甲>0)h+='<div>护甲: '+card.护甲+'</div>'; h+='<div class="card-type">'+esc(card.伤害类型)+'</div>'; }
          else{ h+='<div class="slot-empty-text">未装备</div>'; }
          h+='</div>';
        });
        h+='</div></div>';
        /* Backpack equipment list */
        var equipNames=Object.keys(equipCards);
        if(equipNames.length){
          h+='<div class="'+idPrefix+'-equip-section"><div class="'+idPrefix+'-section-title">背包装备</div><div class="'+idPrefix+'-card-grid">';
          equipNames.forEach(function(name){
            var c=equipCards[name];
            h+='<div class="'+idPrefix+'-skill-card"><div class="card-header"><span class="card-name">'+esc(name)+'</span><span class="card-badge '+c.伤害类型+'">'+c.伤害类型+'</span></div>';
            if(c.伤害)h+='<div class="card-damage">伤害: '+esc(c.伤害)+'</div>';
            if(c.护甲>0)h+='<div>护甲: '+c.护甲+'</div>';
            h+='<div class="card-info"><span>槽位:'+esc(c.槽位)+'</span><span>范围:'+esc(c.范围)+'</span></div>';
            if(c.装备要求)h+='<div class="card-req">要求: '+esc(c.装备要求)+'</div>';
            h+='</div>';
          });
          h+='</div></div>';
        } else { h+='<div class="'+idPrefix+'-empty">背包中暂无装备</div>'; }
      } else { h+='<div class="'+idPrefix+'-empty">无法读取数据</div>'; }
      h+='</div>';
    }

    /* === 道具标签 === */
    if(state_activeTab==='items'){
      h+='<div class="'+idPrefix+'-page active" id="page-items">';
      var d4=fetchStatData();
      if(d4){
        var consumables=readConsumableCards(d4);
        var itemNames=Object.keys(consumables);
        if(itemNames.length){
          h+='<div class="'+idPrefix+'-card-grid">';
          itemNames.forEach(function(name){
            var c=consumables[name];
            h+='<div class="'+idPrefix+'-skill-card"><div class="card-header"><span class="card-name">'+esc(name)+'</span><span class="card-badge" style="background:linear-gradient(120deg,#48bb78,#68d391)">x'+c.数量+'</span></div>';
            h+='<div class="card-damage">效果: '+esc(c.使用效果)+'</div>';
            if(c.描述)h+='<div class="card-desc">'+esc(c.描述)+'</div>';
            if(state.phase==='PLAYER_ACTING')h+='<button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary" data-use-item="'+esc(name)+'" style="margin-top:6px;font-size:11px;">使用</button>';
            h+='</div>';
          });
          h+='</div>';
        } else { h+='<div class="'+idPrefix+'-empty">背包中暂无可用消耗品</div>'; }
      } else { h+='<div class="'+idPrefix+'-empty">无法读取数据</div>'; }
      h+='</div>';
    }

    /* === 日志标签 === */
    if(state_activeTab==='log'){
      h+='<div class="'+idPrefix+'-page active" id="page-log">';
      h+=renderLog(state,idPrefix);
      h+='</div>';
    }

    h+='</div></div>';
    mount.innerHTML=h;
    var logBox=mount.querySelector('#'+idPrefix+'-log-box'); if(logBox)logBox.scrollTop=logBox.scrollHeight;
  }

  function renderBar(mount){
    mount.innerHTML='<div class="cb-bar" data-act="startcombat"><div class="cb-bar-title">⚔ 战斗控制台</div><div class="cb-bar-sub">点击开始战斗 →</div></div>';
  }

  var mounts=[]; var renderTimer=null;
  function renderAllPanels(){
    if(renderTimer)clearTimeout(renderTimer);
    renderTimer=setTimeout(function(){
      mounts.forEach(function(m){ if(!m||!m.parentNode)return; var state=getCombatState(); if(!state||!state.active){ renderBar(m); } else { renderConsole(state,m); } });
      mounts=mounts.filter(function(m){ return m&&m.parentNode; });
    },50);
  }
  function renderCombatPanel(mount){
    if(!mount)return;
    mounts=mounts.filter(function(m){ return m&&m.parentNode&&m!==mount; }); mounts.push(mount);
    var state=getCombatState(); if(!state||!state.active){ renderBar(mount); } else { renderConsole(state,mount); }
  }

  /* ===== 事件处理 ===== */
  function cbHandleClick(act, data, mount){
    var state=getCombatState(); if(!state)state={turn:0,units:[],log:[],phase:'IDLE',active:false,pendingActions:[]};
    /* Tab switch */
    if(act==='tab'){ state_activeTab=data.tab; renderAllPanels(); return; }
    if(act==='startcombat'){
      var d=fetchStatData();
      state={turn:1,units:[],log:[],phase:'PLAYER_ACTING',active:true,targetIdx:1,combatMessageId:null,pendingActions:[]};
      if(d){ var p=seedPlayer(d); calcDerived(p); state.units.push(p); } else { var p2=makeEnemy('玩家',40,12,12,12,12,12,12); p2.isPlayer=true; p2.id='player'; calcDerived(p2); state.units.push(p2); }
      var enName='哥布林',enHp=30,enStr=12,enAgi=14,enCon=10;
      try{ enName=mount.querySelector('#cb-en-name').value||'哥布林'; enHp=parseInt(mount.querySelector('#cb-en-hp').value||'30',10); enStr=mount.querySelector('#cb-en-str').value; enAgi=mount.querySelector('#cb-en-agi').value; enCon=mount.querySelector('#cb-en-con').value; }catch(e){}
      var enemy=makeEnemy(enName,enHp,enStr,enAgi,enCon,8,8,8); calcDerived(enemy); state.units.push(enemy);
      addLog(state,'-- 战斗开始 · 回合1 --');
      var initReport=buildReport(state,'战斗开始！'+state.units.map(function(u){return u.name+' HP'+u.hp+'/'+u.derived.hpMax;}).join(' vs '),'','战斗开始');
      var msgContent='<CombatHud/>\n\n'+initReport; saveCombatState(state);
      try{ if(typeof createChatMessages==='function'){ createChatMessages([{role:'assistant',message:msgContent}],{refresh:'affected'}).then(function(){ try{ if(typeof getLastMessageId==='function'){ state.combatMessageId=getLastMessageId(); saveCombatState(state); } }catch(e){} }); } }catch(e){ console.error('[战斗引擎v6] 创建战斗消息层失败',e); }
      renderAllPanels(); return;
    }
    if(act==='endcombat'){ addLog(state,'-- 战斗结束 --'); appendCombatToLayer('═══ 战斗结束（手动） ═══'); clearCombatState(); renderAllPanels(); return; }
    if(act==='endturn'){ if(!state.active)return; endTurn(state); return; }
    if(act==='removepending'){ if(state.pendingActions){ state.pendingActions.splice(parseInt(data.pidx,10),1); saveCombatState(state); renderAllPanels(); } return; }
    if(!state.active)return;
    if(state.phase==='AI_GENERATING'||state.phase==='ENEMY_RESOLVING')return;
    if(state.phase!=='PLAYER_ACTING')return;
    var rpText=''; try{ var rpInput=mount.querySelector('#cb-rp-input'); if(rpInput)rpText=rpInput.value.trim(); }catch(e){}
    if(act==='attack'){ doPlayerAttack(state,state.targetIdx||1,false,0,rpText); renderAllPanels(); return; }
    if(act==='aoe'){ var radius=prompt('AOE范围半径(格)：','2'); if(radius)doPlayerAttack(state,state.targetIdx||1,true,parseInt(radius,10),rpText); renderAllPanels(); return; }
    if(act==='dodge'){ doDodge(state,rpText); renderAllPanels(); return; }
    if(act==='parry'){ doParry(state,data.pt||'weapon',rpText); renderAllPanels(); return; }
    if(act==='move'){ doMove(state,data.mode||'walk',rpText); renderAllPanels(); return; }
    if(act==='freeroll'){ var input=mount.querySelector('#cb-dice-expr'); doFreeRoll(state,input?input.value:'d20',rpText); renderAllPanels(); return; }
    if(act==='customaction'){ if(!rpText){ addLog(state,'请在RP输入框描述你的行动'); return; } var rollType=prompt('选择投骰类型（留空=不投骰纯RP）：\nr力量 / rd敏捷 / r智力 / d20 / d100 / 3d6',''); if(rollType===null)return; rollType=rollType.trim(); doCustomAction(state,rpText,rollType); renderAllPanels(); return; }
    if(act==='atktype'){ var p=state.units.find(function(u){return u.isPlayer;}); if(p){ p.atkType=(p.atkType==='magic'?'phys':'magic'); saveCombatState(state); renderAllPanels(); } return; }
    if(act==='wtype'){ var pw=state.units.find(function(u){return u.isPlayer;}); if(pw){ pw.weaponType=(pw.weaponType==='twohand'?'onehand':'twohand'); saveCombatState(state); renderAllPanels(); } return; }
    if(act==='addenemy'){ var name=prompt('敌人名称：','哥布林'); if(!name)return; var hp=parseInt(prompt('HP：','30')||'30',10); var str=prompt('力量(默认12)：','12')||12; var agi=prompt('敏捷(默认14)：','14')||14; var con=prompt('体质(默认10)：','10')||10; var en2=makeEnemy(name,hp,str,agi,con,8,8,8); calcDerived(en2); state.units.push(en2); state.targetIdx=state.units.length-1; addLog(state,name+'加入战场(HP '+hp+')'); saveCombatState(state); renderAllPanels(); return; }
    if(act==='addbuff'){ openBuffModal(state); return; }
    if(act==='counter'){ doCounter(state,state.targetIdx||1,rpText); renderAllPanels(); return; }
    if(act==='dualwield'){ doDualWield(state,state.targetIdx||1,rpText); renderAllPanels(); return; }
    if(act==='throw'){ doThrow(state,state.targetIdx||1,rpText); renderAllPanels(); return; }
    if(act==='skilledit'){ openSkillEditor(); return; }
    if(act==='useitem'){ doUseConsumable(state,data.itemName||data.name||'',rpText); renderAllPanels(); return; }
  }
  function cbHandleHp(idx,delta){ var state=getCombatState(); if(!state)return; adjustHP(state,idx,delta); renderAllPanels(); }
  function cbHandleTarget(idx){ var state=getCombatState(); if(!state)return; state.targetIdx=idx; state_targetIdx=idx; saveCombatState(state); renderAllPanels(); }
  function cbHandleBuff(unitIdx,buffIdx){ var state=getCombatState(); if(!state)return; removeBuff(state,unitIdx,buffIdx); renderAllPanels(); }
  function cbHandleQuick(expr,mount){ var state=getCombatState(); if(!state)return; if(state.phase!=='PLAYER_ACTING')return; var input=mount.querySelector('#cb-dice-expr'); if(input)input.value=expr; var rpText=''; try{ var rpInput=mount.querySelector('#cb-rp-input'); if(rpInput)rpText=rpInput.value.trim(); }catch(e){} doFreeRoll(state,expr,rpText); renderAllPanels(); }
  function cbHandleSkill(skillName){ var state=getCombatState(); if(!state)return; if(state.phase!=='PLAYER_ACTING'){ if(typeof toastr!=='undefined')toastr.warning('当前不是玩家行动阶段'); return; } var rpText=''; try{ var ms=mounts; for(var i=0;i<ms.length;i++){ var m=ms[i]; if(m&&m.parentNode){ var rpInput=m.querySelector('#cb-rp-input'); if(rpInput){ rpText=rpInput.value.trim(); break; } } } }catch(e){} doSkill(state,skillName,state.targetIdx||1,rpText); renderAllPanels(); }
  function cbHandleUseItem(itemName){ var state=getCombatState(); if(!state)return; if(state.phase!=='PLAYER_ACTING'){ if(typeof toastr!=='undefined')toastr.warning('当前不是玩家行动阶段'); return; } var rpText=''; try{ var ms=mounts; for(var i=0;i<ms.length;i++){ var m=ms[i]; if(m&&m.parentNode){ var rpInput=m.querySelector('#cb-rp-input'); if(rpInput){ rpText=rpInput.value.trim(); break; } } } }catch(e){} doUseConsumable(state,itemName,rpText); renderAllPanels(); }

  /* ===== Buff Modal ===== */
  function openBuffModal(state){
    var overlay=HOST.document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    var unitOpts=state.units.map(function(u,i){ return '<option value="'+i+'">'+esc(u.name)+'</option>'; }).join('');
    overlay.innerHTML='<div style="background:#f3eefc;border:1px solid rgba(167,139,250,0.5);border-radius:14px;padding:18px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(140,120,200,0.18);font-family:inherit;color:#463f63;"><div style="font-weight:700;margin-bottom:10px;font-size:14px;">施加 Buff / Debuff</div><div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">目标单位</label><select id="cb-mf-unit" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;">'+unitOpts+'</select></div><div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">状态名称</label><input id="cb-mf-name" placeholder="如：力量增幅" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;"></div><div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">持续回合</label><input id="cb-mf-turns" value="3" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;"></div><div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">作用属性</label><select id="cb-mf-target" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;"><option value="">（仅标记）</option><option value="力量">力量</option><option value="敏捷">敏捷</option><option value="体质">体质</option><option value="智力">智力</option><option value="精神">精神</option><option value="能量值最大">能量值最大(×)</option></select></div><div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">运算</label><select id="cb-mf-op" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;"><option value="+">+ 加法(可负)</option><option value="*">× 乘法(如2=翻倍)</option></select></div><div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">数值</label><input id="cb-mf-val" value="10" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;"></div><div style="display:flex;gap:6px;justify-content:flex-end;margin-top:12px;"><button id="cb-mf-cancel" style="background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;">取消</button><button id="cb-mf-ok" style="background:rgba(167,139,250,0.2);border:1px solid rgba(167,139,250,0.5);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;color:#463f63;font-weight:600;">施加</button></div></div>';
    HOST.document.body.appendChild(overlay);
    overlay.querySelector('#cb-mf-cancel').onclick=function(){ overlay.remove(); };
    overlay.querySelector('#cb-mf-ok').onclick=function(){ var ui=parseInt(overlay.querySelector('#cb-mf-unit').value,10); var name=overlay.querySelector('#cb-mf-name').value||'状态'; var turns=parseInt(overlay.querySelector('#cb-mf-turns').value||'3',10); var target=overlay.querySelector('#cb-mf-target').value; var op=overlay.querySelector('#cb-mf-op').value; var val=overlay.querySelector('#cb-mf-val').value; addBuff(state,ui,name,turns,target,op,val); overlay.remove(); renderAllPanels(); };
  }

  /* ===== 技能编辑器 ===== */
  function openSkillEditor(){
    var cfg=getSkillConfig(); var overlay=HOST.document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    var modal=HOST.document.createElement('div');
    modal.style.cssText='background:#f3eefc;border:1px solid rgba(167,139,250,0.5);border-radius:18px;padding:20px;max-width:520px;width:92%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(140,120,200,0.18);font-family:inherit;color:#463f63;';
    var html='<div style="font-weight:700;font-size:16px;margin-bottom:12px;color:#a78bfa;">技能配置编辑器</div><div id="skill-list" style="margin-bottom:12px;">';
    Object.keys(cfg).forEach(function(name){ var s=cfg[name]; html+='<div style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:10px;padding:8px 12px;margin-bottom:6px;cursor:pointer;" data-edit-skill="'+esc(name)+'"><b style="color:#a78bfa;">'+esc(name)+'</b> <span style="font-size:10px;color:#6b6488;">'+esc(s.type)+'/'+esc(s.category)+' AP:'+esc(s.apCost)+' CD:'+esc(s.cooldown)+'</span><div style="font-size:10px;color:#6b6488;margin-top:2px;">'+esc(s.desc||'')+'</div></div>'; });
    html+='</div><div style="display:flex;gap:6px;"><input id="new-skill-name" placeholder="新技能名称" style="flex:1;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:5px 10px;font-size:12px;color:#463f63;"><button id="add-skill-btn" style="background:rgba(167,139,250,0.2);border:1px solid rgba(167,139,250,0.4);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;color:#a78bfa;font-weight:600;">添加</button><button id="close-skill-editor" style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;color:#463f63;">关闭</button></div>';
    modal.innerHTML=html; overlay.appendChild(modal); HOST.document.body.appendChild(overlay);
    overlay.querySelector('#close-skill-editor').onclick=function(){ overlay.remove(); };
    overlay.querySelector('#add-skill-btn').onclick=function(){ var name=overlay.querySelector('#new-skill-name').value.trim(); if(!name)return; if(cfg[name]){ alert('技能已存在'); return; } cfg[name]={name:name,type:'物理',category:'主动技能',hitBase:0,hitExpr:'r力量',apCost:3,range:2,rangeType:'melee',damage:'d4+DB',cooldown:2,aoeRadius:0,isChanting:false,isInstant:false,buffs:[],debuffs:[],desc:''}; saveSkillConfig(cfg); overlay.remove(); openSkillEditor(); };
    var els=overlay.querySelectorAll('[data-edit-skill]'); for(var i=0;i<els.length;i++){ els[i].onclick=function(){ var sn=this.getAttribute('data-edit-skill'); overlay.remove(); openSkillEditForm(sn); }; }
  }
  function openSkillEditForm(skillName){
    var cfg=getSkillConfig(); var s=cfg[skillName]; if(!s)return;
    var overlay=HOST.document.createElement('div'); overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    var modal=HOST.document.createElement('div'); modal.style.cssText='background:#f3eefc;border:1px solid rgba(167,139,250,0.5);border-radius:18px;padding:20px;max-width:460px;width:92%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(140,120,200,0.18);font-family:inherit;color:#463f63;';
    function field(label,id,val,ph){ return '<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;display:block;">'+label+'</label><input id="'+id+'" value="'+esc(val)+'" placeholder="'+esc(ph||'')+'" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:5px 10px;font-size:12px;color:#463f63;"></div>'; }
    function sel(label,id,opts,val){ var h='<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;display:block;">'+label+'</label><select id="'+id+'" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:5px 10px;font-size:12px;color:#463f63;">'; opts.forEach(function(o){var v=typeof o==='object'?o.v:o,l=typeof o==='object'?o.l:o; h+='<option value="'+esc(v)+'"'+(v===val?' selected':'')+'>'+esc(l)+'</option>';}); h+='</select></div>'; return h; }
    modal.innerHTML='<div style="font-weight:700;font-size:15px;margin-bottom:12px;color:#a78bfa;">编辑技能: '+esc(skillName)+'</div>'+field('名称','se-name',s.name)+sel('类型','se-type',['物理','法术','辅助','召唤'],s.type)+sel('分类','se-category',[{v:'主动技能',l:'主动技能(3AP)'},{v:'瞬发技能',l:'瞬发技能(1AP)'},{v:'吟唱技能',l:'吟唱技能(5AP)'},{v:'连发技能',l:'连发技能(0AP)'}],s.category)+field('命中表达式','se-hitExpr',s.hitExpr,'r力量 / r智力 / d20 / 空=必中')+field('基础命中加成','se-hitBase',s.hitBase,'数字')+field('AP消耗','se-apCost',s.apCost,'如3')+sel('射程类型','se-rangeType',[{v:'melee',l:'近战(2格)'},{v:'ranged',l:'远程(99格)'},{v:'self',l:'自身'}],s.rangeType)+field('伤害表达式','se-damage',s.damage,'d4+DB / d6+DB / 空=无伤害')+field('冷却回合','se-cooldown',s.cooldown,'如3')+field('AOE半径','se-aoeRadius',s.aoeRadius,'0=单体')+field('描述','se-desc',s.desc,'技能描述')+field('buffs(JSON)','se-buffs',JSON.stringify(s.buffs||[]),'[]')+field('debuffs(JSON)','se-debuffs',JSON.stringify(s.debuffs||[]),'[]')+'<div style="display:flex;gap:6px;margin-top:12px;"><button id="se-save" style="flex:1;background:rgba(167,139,250,0.2);border:1px solid rgba(167,139,250,0.4);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;color:#a78bfa;font-weight:600;">保存</button><button id="se-delete" style="background:rgba(229,62,62,0.1);border:1px solid rgba(229,62,62,0.3);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;color:#e53e3e;">删除</button><button id="se-cancel" style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;color:#463f63;">取消</button></div>';
    overlay.appendChild(modal); HOST.document.body.appendChild(overlay);
    overlay.querySelector('#se-cancel').onclick=function(){ overlay.remove(); };
    overlay.querySelector('#se-delete').onclick=function(){ if(confirm('确认删除？')){ delete cfg[skillName]; saveSkillConfig(cfg); overlay.remove(); } };
    overlay.querySelector('#se-save').onclick=function(){ var newName=overlay.querySelector('#se-name').value.trim(); var updated={name:newName,type:overlay.querySelector('#se-type').value,category:overlay.querySelector('#se-category').value,hitExpr:overlay.querySelector('#se-hitExpr').value.trim(),hitBase:num(overlay.querySelector('#se-hitBase').value,0),apCost:num(overlay.querySelector('#se-apCost').value,3),rangeType:overlay.querySelector('#se-rangeType').value,damage:overlay.querySelector('#se-damage').value.trim(),cooldown:num(overlay.querySelector('#se-cooldown').value,0),aoeRadius:num(overlay.querySelector('#se-aoeRadius').value,0),desc:overlay.querySelector('#se-desc').value.trim(),isChanting:overlay.querySelector('#se-category').value==='吟唱技能',isInstant:overlay.querySelector('#se-category').value==='瞬发技能'}; try{ updated.buffs=JSON.parse(overlay.querySelector('#se-buffs').value||'[]'); }catch(e){ updated.buffs=[]; } try{ updated.debuffs=JSON.parse(overlay.querySelector('#se-debuffs').value||'[]'); }catch(e){ updated.debuffs=[]; } if(newName!==skillName){ delete cfg[skillName]; } cfg[newName]=updated; saveSkillConfig(cfg); overlay.remove(); };
  }

  /* ===== 事件监听 ===== */
  function bindTavernEvents(){
    try{
      var evOn=(typeof HOST.eventOn==='function')?HOST.eventOn:((typeof eventOn==='function')?eventOn:null);
      var evts=(typeof HOST.tavern_events!=='undefined')?HOST.tavern_events:((typeof tavern_events!=='undefined')?tavern_events:null);
      if(evOn&&evts){
        if(evts.CHARACTER_MESSAGE_RENDERED){ evOn(evts.CHARACTER_MESSAGE_RENDERED, function(){ setTimeout(function(){ checkSkillRegister(); checkEnemySpawn(); }, 400); }); }
        if(evts.MESSAGE_UPDATED){ evOn(evts.MESSAGE_UPDATED, function(){ setTimeout(function(){ checkSkillRegister(); checkEnemySpawn(); }, 400); }); }
        if(evts.GENERATION_ENDED){ evOn(evts.GENERATION_ENDED, function(){ setTimeout(function(){ checkSkillRegister(); checkEnemySpawn(); }, 600); }); }
      }
    }catch(e){ console.warn('[战斗引擎v6] 事件绑定失败',e); }
  }
  bindTavernEvents();

  /* ===== 暴露API到HOST ===== */
  HOST.renderCombatPanel=renderCombatPanel;
  HOST.cbHandleClick=cbHandleClick;
  HOST.cbHandleHp=cbHandleHp;
  HOST.cbHandleTarget=cbHandleTarget;
  HOST.cbHandleBuff=cbHandleBuff;
  HOST.cbHandleQuick=cbHandleQuick;
  HOST.cbHandleSkill=cbHandleSkill;
  HOST.cbHandleUseItem=cbHandleUseItem;
  HOST.openSkillEditor=openSkillEditor;
  HOST.checkSkillRegister=checkSkillRegister;
  HOST.registerSkill=registerSkill;
  HOST.syncSkillsFromStatData=syncSkillsFromStatData;
  HOST.getCombatState=getCombatState;
  HOST.startCombatSession=startCombatSession;
  HOST.appendCombatToLayer=appendCombatToLayer;
  HOST.parseEnemySpawn=parseEnemySpawn;
  HOST.checkEnemySpawn=checkEnemySpawn;
  HOST.readSkillCards=readSkillCards;
  HOST.readEquipmentCards=readEquipmentCards;
  HOST.readConsumableCards=readConsumableCards;
  HOST.evalDiceStr=evalDiceStr;
  HOST.nebDice=nebDice;
  HOST.combatAction=function(act, params){
    var state=getCombatState(); if(!state)return; if(state.phase!=='PLAYER_ACTING')return;
    var rpText=(params&&params.rpText)||'';
    switch(act){
      case 'attack': doPlayerAttack(state,params&&params.target||1,false,0,rpText); break;
      case 'dodge': doDodge(state,rpText); break;
      case 'parry': doParry(state,params&&params.pt||'weapon',rpText); break;
      case 'move': doMove(state,params&&params.mode||'walk',rpText); break;
      case 'freeroll': doFreeRoll(state,params&&params.expr||'d20',rpText); break;
      case 'custom': doCustomAction(state,rpText,params&&params.rollType||''); break;
      case 'useitem': doUseConsumable(state,params&&params.itemName||'',rpText); break;
      case 'endturn': endTurn(state); break;
    }
    renderAllPanels();
  };

  /* ===== 同层前端适配: enterCombat + CombatV6 命名空间 (增量, 不改既有逻辑) ===== */
  async function enterCombat(spawns, opts){
    opts=opts||{};
    var d=fetchStatData();
    var state={turn:1,units:[],log:[],phase:'PLAYER_ACTING',active:true,targetIdx:1,combatMessageId:null,pendingActions:[]};
    if(d){ var p=seedPlayer(d); calcDerived(p); state.units.push(p); }
    else{ var p2=makeEnemy('玩家',40,12,12,12,12,12,12); p2.isPlayer=true; p2.id='player'; calcDerived(p2); state.units.push(p2); }
    var arr=Array.isArray(spawns)?spawns:[];
    arr.forEach(function(s){
      var en=makeEnemy(s.name||'敌人', s.hp||30, s.str||12, s.agi||14, s.con||10, 8,8,8);
      calcDerived(en); state.units.push(en);
    });
    addLog(state,'-- 战斗开始 · 回合1 --');
    saveCombatState(state);
    var initReport=buildReport(state,'战斗开始！'+state.units.map(function(u){return u.name+' HP'+u.hp+'/'+u.derived.hpMax;}).join(' vs '),'','战斗开始');
    var msgContent = opts.injectCombatHud ? ('<CombatHud/>\n\n'+initReport) : initReport;
    try{ if(typeof createChatMessages==='function'){ await createChatMessages([{role:'assistant',message:msgContent}],{refresh:'affected'}); } }catch(e){ console.error('[战斗引擎v6] enterCombat创建战斗消息层失败',e); }
    try{ if(typeof getLastMessageId==='function'){ state.combatMessageId=getLastMessageId(); } }catch(e){}
    saveCombatState(state);
    return state;
  }
  HOST.enterCombat=enterCombat;
  HOST.CombatV6={
    nebDice:nebDice, evalDiceStr:evalDiceStr, lookupDB:lookupDB,
    resolveAttack:resolveAttack, calcDerived:calcDerived, buildBuffedContext:buildBuffedContext,
    seedPlayer:seedPlayer, makeEnemy:makeEnemy, fetchStatData:fetchStatData,
    readSkillCards:readSkillCards, readEquipmentCards:readEquipmentCards, readConsumableCards:readConsumableCards, getEquippedSlots:getEquippedSlots,
    doPlayerAttack:doPlayerAttack, doSkill:doSkill, doDodge:doDodge, doParry:doParry, doMove:doMove, doFreeRoll:doFreeRoll, doCustomAction:doCustomAction, doUseConsumable:doUseConsumable, doCounter:doCounter, doDualWield:doDualWield, doThrow:doThrow,
    addBuff:addBuff, removeBuff:removeBuff, adjustHP:adjustHP,
    endTurn:endTurn, tick:tick, addActionToQueue:addActionToQueue,
    buildReport:buildReport, buildBattleSnapshot:buildBattleSnapshot, appendCombatToLayer:appendCombatToLayer,
    callAI:callAI, cleanAIReply:cleanAIReply, processAIReply:processAIReply, resolveEnemyAction:resolveEnemyAction, parseEnemyAction:parseEnemyAction, parseEnemySpawn:parseEnemySpawn, checkEnemySpawn:checkEnemySpawn,
    getCombatState:getCombatState, saveCombatState:saveCombatState, clearCombatState:clearCombatState,
    distance:distance, inRange:inRange, unitsInAOE:unitsInAOE, ATTRS:ATTRS, ROLL_TARGETS:ROLL_TARGETS,
    startCombatSession:startCombatSession, enterCombat:enterCombat, combatAction:HOST.combatAction,
    renderCombatPanel:renderCombatPanel
  };

  console.log('[多维矩阵·战斗引擎] v6 已加载（通用骰子+技能/装备卡片+多动作回合+伤害类型+消耗品+敌人生成 + 同层前端适配）');
})();
