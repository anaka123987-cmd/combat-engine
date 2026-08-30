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
  var WEAPON_RANGE={onehand:2,twohand:2,pistol:50,shotgun:25,melee:2}; /* 米制：1格≈1米 */
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
        var bf=String(b.formula==null?'':b.formula).trim()||'0';
        if(b.op==='-'&&bf.charAt(0)!=='-')bf='-'+bf; /* 与 getBuffMod 同规则：op='-' 取负，避免减益当增益 */
        ctx.attrMods[b.target].push(bf);
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
    var sum=0; (unit.buffs||[]).forEach(function(b){
      if(b.effect==='attr_mod'&&b.target===attr){
        var m=num(b.flatVal,0);
        if(b.op==='-'){ if(m>0)m=-m; }          /* op='-' 且 flatVal 为量纲值时取负；flatVal 已带负号不重复取 */
        else if(b.op!=='+'&&b.op!=='-'){ m=0; } /* 乘除型 attr_mod 无法线性叠加，只参与骰子公式 */
        sum+=m;
      }
    });
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
    d.energyMax=Math.floor(num(eff['精神'],10)*2+num(unit.equipBonus&&unit.equipBonus.energy,0));
    if(d.energyMax<1)d.energyMax=1;
    /* 生命公式（作者定义）：100+(体质-10)×10；MVU 的 生命值.最大 优先（AI/创建时写入），缺失或非法时按公式兜底 */
    d.hpMax=num(unit.hpMaxBase,0);
    if(d.hpMax<1)d.hpMax=Math.max(1,100+(num(eff['体质'],10)-10)*10);
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

  /* ======================================================================
   * 地形系统 (Terrain System) — A6
   * state.terrain = {width, height, cells: 2D数组}
   * cell = {type, height, blocking, cost, effect, cover}
   * 类型: 平地|高地|墙壁|陷阱|掩体|水域|狭窄
   * ====================================================================== */
  function parseTerrain(text){
    if(!text)return null;
    var m=String(text).match(/<terrain>\s*([\s\S]*?)\s*<\/terrain>/i);
    if(!m)return null;
    var raw=m[1].trim();
    var terrain={width:12,height:8,cells:[]};
    /* 解析 "宽12高8;高地:(3,4);墙:(0,0)-(0,7);陷阱:(7,7);水:(2,2)-(4,2)" */
    var parts=raw.split(';');
    for(var p=0;p<parts.length;p++){
      var part=parts[p].trim(); if(!part)continue;
      var wm=part.match(/宽(\d+)/); if(wm)terrain.width=parseInt(wm[1],10);
      var hm=part.match(/高(\d+)/); if(hm)terrain.height=parseInt(hm[1],10);
    }
    /* 初始化grid */
    for(var y=0;y<terrain.height;y++){
      terrain.cells[y]=[];
      for(var x=0;x<terrain.width;x++){ terrain.cells[y][x]={type:'平地',height:0,blocking:false,cost:1,effect:null,cover:0}; }
    }
    /* 解析地形特征 */
    for(var q=0;q<parts.length;q++){
      var seg=parts[q].trim(); if(!seg)continue;
      /* 高地:(3,4) 或 高地:(3,4)-(5,6) */
      var fm=seg.match(/(高地|墙壁|墙|陷阱|掩体|水域|水|狭窄)\s*:\s*\((\d+),(\d+)\)(?:-\((\d+),(\d+)\))?/);
      if(fm){
        var type=fm[1];
        /* 规范化简称 */
        if(type==='墙')type='墙壁';
        if(type==='水')type='水域';
        var x1=parseInt(fm[2],10),y1=parseInt(fm[3],10);
        var x2=fm[4]?parseInt(fm[4],10):x1, y2=fm[5]?parseInt(fm[5],10):y1;
        applyTerrainFeature(terrain,type,x1,y1,x2,y2);
      }
    }
    return terrain;
  }
  function applyTerrainFeature(terrain,type,x1,y1,x2,y2){
    var minX=Math.min(x1,x2),maxX=Math.max(x1,x2),minY=Math.min(y1,y2),maxY=Math.max(y1,y2);
    for(var y=minY;y<=maxY;y++){
      for(var x=minX;x<=maxX;x++){
        if(y<0||y>=terrain.height||x<0||x>=terrain.width)continue;
        var cell=terrain.cells[y][x];
        cell.type=type;
        switch(type){
          case '高地': cell.height=1; cell.effect='高地'; break;
          case '墙壁': cell.blocking=true; break;
          case '陷阱': cell.effect='陷阱'; break;
          case '掩体': cell.cover=1; break;
          case '水域': cell.cost=2; cell.effect='水域'; break;
          case '狭窄': cell.effect='狭窄'; break;
        }
      }
    }
  }
  function terrainAt(state,x,y){
    if(!state||!state.terrain||!state.terrain.cells)return null;
    if(y<0||y>=state.terrain.height||x<0||x>=state.terrain.width)return null;
    return state.terrain.cells[y][x];
  }
  /* 视线检查（BFS，墙挡视线） */
  function inLineOfSight(state,a,b){
    if(!state||!state.terrain)return true;
    var x0=num(a.x,0),y0=num(a.y,0),x1=num(b.x,0),y1=num(b.y,0);
    var dx=Math.abs(x1-x0),dy=Math.abs(y1-y0);
    var sx=x0<x1?1:-1, sy=y0<y1?1:-1;
    var err=dx-dy, x=x0, y=y0;
    while(x!==x1||y!==y1){
      var e2=2*err;
      if(e2>-dy){ err-=dy; x+=sx; }
      if(e2<dx){ err+=dx; y+=sy; }
      if(x===x1&&y===y1)break;
      var cell=terrainAt(state,x,y);
      if(cell&&cell.blocking)return false; /* 墙挡视线 */
    }
    return true;
  }
  /* A*寻路（尊重blocking+cost） */
  function pathfind(state,start,goal){
    if(!state||!state.terrain)return [start,goal];
    var w=state.terrain.width,h=state.terrain.height;
    var sx=num(start.x,0),sy=num(start.y,0),gx=num(goal.x,0),gy=num(goal.y,0);
    if(gx<0||gx>=w||gy<0||gy>=h)return null;
    var open=[{x:sx,y:sy,g:0,f:Math.abs(sx-gx)+Math.abs(sy-gy),parent:null}];
    var closed={};
    var maxIter=w*h*4, iter=0;
    while(open.length&&iter<maxIter){
      iter++;
      open.sort(function(a,b){return a.f-b.f;});
      var cur=open.shift();
      var key=cur.x+','+cur.y;
      if(closed[key])continue;
      closed[key]=cur;
      if(cur.x===gx&&cur.y===gy){
        /* 回溯路径 */
        var path=[]; var node=cur;
        while(node){ path.unshift({x:node.x,y:node.y}); node=node.parent; }
        return path;
      }
      var dirs=[[0,1],[0,-1],[1,0],[-1,0]];
      for(var d=0;d<4;d++){
        var nx=cur.x+dirs[d][0], ny=cur.y+dirs[d][1];
        if(nx<0||nx>=w||ny<0||ny>=h)continue;
        var nkey=nx+','+ny;
        if(closed[nkey])continue;
        var cell=terrainAt(state,nx,ny);
        if(cell&&cell.blocking)continue; /* 墙不可过 */
        var cost=cell?cell.cost:1;
        var ng=cur.g+cost;
        var nf=ng+Math.abs(nx-gx)+Math.abs(ny-gy);
        open.push({x:nx,y:ny,g:ng,f:nf,parent:cur});
      }
    }
    return null; /* 无路径 */
  }
  /* 地形修正：resolveAttack时应用 */
  function getTerrainAttackMods(state,att,def){
    var mods={hitBonus:'',dmgReduce:0,extraLog:''};
    if(!state||!state.terrain)return mods;
    var attCell=terrainAt(state,att.x,att.y);
    var defCell=terrainAt(state,def.x,def.y);
    /* 高地+命中+射程 */
    if(attCell&&attCell.type==='高地'){ mods.hitBonus='+d4'; mods.extraLog+=' [高地+命中]'; }
    /* 掩体减伤 */
    if(defCell&&defCell.cover>0){ mods.dmgReduce=Math.floor(mods.dmgReduce+defCell.cover*0.3); mods.extraLog+=' [掩体减伤'+(defCell.cover*30)+'%]'; }
    /* 水域-火伤（火系技能在水域减伤） */
    if(defCell&&defCell.type==='水域'){ mods.extraLog+=' [水域环境]'; }
    return mods;
  }
  /* 触发陷阱 */
  function triggerTrap(state,unit){
    if(!state||!state.terrain)return;
    var cell=terrainAt(state,unit.x,unit.y);
    if(cell&&cell.type==='陷阱'){
      var dmg=rollDie(6); unit.hp-=dmg; if(unit.hp<0)unit.hp=0;
      cell.type='平地'; cell.effect=null; /* 触发后消失 */
      addLog(state,unit.name+' 踩中陷阱！受到'+dmg+'点伤害，HP→'+unit.hp);
    }
  }
  /* evaluateCondition地形关键词支持 */
  function checkTerrainCondition(state,unit,cond){
    if(!state||!state.terrain)return false;
    var cell=terrainAt(state,unit.x,unit.y);
    if(!cell)return false;
    if(cond.indexOf('高地')>=0)return cell.type==='高地';
    if(cond.indexOf('水域')>=0)return cell.type==='水域';
    if(cond.indexOf('靠墙')>=0){
      /* 检查相邻是否有墙 */
      var neighbors=[[0,1],[0,-1],[1,0],[-1,0]];
      for(var i=0;i<4;i++){ var c=terrainAt(state,unit.x+neighbors[i][0],unit.y+neighbors[i][1]); if(c&&c.blocking)return true; }
      return false;
    }
    if(cond.indexOf('陷阱')>=0){
      var neighbors2=[[0,1],[0,-1],[1,0],[-1,0],[0,0]];
      for(var j=0;j<5;j++){ var c2=terrainAt(state,unit.x+neighbors2[j][0],unit.y+neighbors2[j][1]); if(c2&&c2.type==='陷阱')return true; }
      return false;
    }
    return false;
  }

  /* ===== 最新楼层ID（避免使用运行时不会被替换的 {{lastMessageId}} 宏） ===== */
  function lastMsgIdSafe(){
    try{ if(typeof getLastMessageId==='function'){ var n=Number(getLastMessageId()); if(!isNaN(n))return n; } }catch(e){}
    try{ if(typeof getCurrentMessageId==='function'){ var n2=Number(getCurrentMessageId()); if(!isNaN(n2))return n2; } }catch(e2){}
    return null;
  }

  /* ===== MVU stat_data读取 ===== */
  function fetchStatData(){
    try{
      if(typeof getChatMessages==='function'){
        var lid=lastMsgIdSafe();
        var msgs=lid!=null?getChatMessages('0-'+lid):null;
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

  /* ===== 当前操控单位（玩家或被切换的队友） ===== */
  function getControlledUnit(state){
    if(!state)return null;
    if(state.controlledUnitId){
      var cu=state.units.find(function(u){return u.id===state.controlledUnitId&&(u.isPlayer||u.isAlly)&&u.hp>0;});
      if(cu)return cu;
    }
    return state.units.find(function(u){return u.isPlayer&&u.hp>0;})||state.units.find(function(u){return u.isPlayer;});
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
          unit.buffs.push({name:'装备:'+itemName,effect:'attr_mod',target:eff.target,op:eff.op||'+',formula:eff.formula,flatVal:num(eff.formula,0),turns:-1,source:itemName,sourceType:'equipment'});
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
      /* A9: 清除本回合的闪避/格挡/移动标记 */
      u._isDodging=false; u._parryState=null; u._isMoving=false; u._isCountering=false;
      calcDerived(u); u.ap=u.derived.apMax;
    });
    addLog(state,'-- 回合 '+state.turn+' -- AP恢复满，冷却/buff递减 --');
  }
  function addLog(state,text,cls){ if(!state.log)state.log=[]; state.log.push({turn:state.turn,text:text,cls:cls||''}); if(state.log.length>60)state.log.shift(); }
  function costAP(unit,ap){ unit.ap-=ap; unit.hp-=ap*5; if(unit.hp<0)unit.hp=0; }

  /* ======================================================================
   * <pos> 站位系统 + 持械攻击模式 + 队列回滚（新增）
   * ====================================================================== */
  /* 解析 <pos>块：一行一个 名称|(x,y)，兼容全角（），｜，，；取最后一个块，同名后行覆盖前行 */
  function parsePositions(text){
    if(!text)return null;
    var blocks=String(text).match(/<pos>([\s\S]*?)<\/pos>/gi);
    if(!blocks||!blocks.length)return null;
    var raw=blocks[blocks.length-1].replace(/<\/?pos>/gi,'');
    var map={}, order=[];
    raw.split(/\r?\n/).forEach(function(line){
      var mm=line.trim().match(/^([^|()（）]+?)\s*[|｜]\s*[（(]\s*(\d+)\s*[,，]\s*(\d+)\s*[)）]\s*$/);
      if(mm){ var k=mm[1].trim(); map[k]={x:parseInt(mm[2],10),y:parseInt(mm[3],10)}; order.push(k); }
    });
    return order.length?{map:map,order:order}:null;
  }
  /* 玩家别名：主页.代号 / 主页.姓名 / "玩家" / 单位名，均可指代玩家 */
  function playerAliases(data,pUnit){
    var alias={'玩家':1};
    try{
      var code=String(getValue(data,'主页.代号','')||'').trim();
      var nm=String(getValue(data,'主页.姓名','')||'').trim();
      if(code)alias[code]=1; if(nm)alias[nm]=1;
    }catch(e){}
    if(pUnit&&pUnit.name){ var un=String(pUnit.name).trim(); if(un)alias[un]=1; }
    return alias;
  }
  /* 应用 <pos> 到战斗单位：按名匹配（玩家走别名），同名多个按出现顺序依次对应；
     墙壁/越界坐标忽略并写战报 */
  function applyPositions(state,text){
    try{
      if(!state||!state.units)return false;
      var pp=parsePositions(text); if(!pp)return false;
      var data=fetchStatData();
      var pUnit=getControlledUnit(state);
      var alias=playerAliases(data,pUnit);
      var cursor={};
      var applied=0;
      pp.order.forEach(function(k){
        var pos=pp.map[k]; if(!pos)return;
        var isPlayerKey=!!alias[k];
        var cands=[];
        state.units.forEach(function(u){
          if(u.hp<=0)return;
          if(isPlayerKey){ if(u.isPlayer)cands.push(u); }
          else { if(!u.isPlayer&&String(u.name||'').trim()===k)cands.push(u); }
        });
        var idx=cursor[k]||0; cursor[k]=idx+1;
        var u=cands[idx]; if(!u)return;
        if(state.terrain){
          if(pos.x<0||pos.y<0||pos.x>=state.terrain.width||pos.y>=state.terrain.height){ addLog(state,'[站位] '+u.name+' 坐标('+pos.x+','+pos.y+')越界，已忽略'); return; }
          var cell=terrainAt(state,pos.x,pos.y);
          if(cell&&cell.blocking){ addLog(state,'[站位] '+u.name+' 坐标('+pos.x+','+pos.y+')是墙壁，已忽略'); return; }
        }
        u.x=pos.x; u.y=pos.y; applied++;
      });
      if(applied){ addLog(state,'[站位] 已按<pos>更新 '+applied+' 个单位坐标'); return true; }
    }catch(e){ console.warn('[战斗引擎v6] pos应用失败',e); }
    return false;
  }
  /* 输出当前全部存活单位站位为 <pos> 块（玩家用 代号‖姓名‖"玩家"） */
  function buildPositionsBlock(state){
    var data=fetchStatData();
    var code='',nm='';
    try{ code=String(getValue(data,'主页.代号','')||'').trim(); nm=String(getValue(data,'主页.姓名','')||'').trim(); }catch(e){}
    var lines=[];
    (state.units||[]).forEach(function(u){
      if(u.hp<=0)return;
      var n=u.isPlayer?(code||nm||'玩家'):String(u.name||'未知');
      lines.push(n+'|('+num(u.x,0)+','+num(u.y,0)+')');
    });
    return '<pos>\n'+lines.join('\n')+'\n</pos>';
  }
  /* 持械攻击模式：单手2AP / 双持(副手为武器)4AP / 双手武器3AP(力量不达标+1)
     返回 {mode:'single'|'dual'|'twohand', apCost, label} */
  function getAttackMode(unit,data){
    var u=unit||{};
    var wt=u.weaponType||'onehand';
    var cards={};
    try{ cards=data?readEquipmentCards(data):{}; }catch(e){}
    var offName=u.equippedSlots?u.equippedSlots['副手']:null;
    var offCard=offName?cards[offName]:null;
    var isDual=!!(offCard&&(String(offCard.槽位||'')==='武器'||String(offCard.伤害||'').trim()!==''));
    var str=num(u.eff&&u.eff['力量']?u.eff['力量']:u.attrs?u.attrs['力量']:10,10);
    if(isDual)return {mode:'dual',apCost:4,label:'双持'};
    if(wt==='twohand'){
      var apCost=3;
      var wreq=12;
      try{
        var wm=(offName===null&&u.equippedSlots&&u.equippedSlots['武器'])?cards[u.equippedSlots['武器']]:null;
        if(wm&&wm.装备要求){ var rm=String(wm.装备要求).match(/力量\s*(\d+)/); if(rm)wreq=parseInt(rm[1],10); }
      }catch(e2){}
      if(str<wreq)apCost+=1;
      return {mode:'twohand',apCost:apCost,label:'双手'};
    }
    return {mode:'single',apCost:2,label:'单手'};
  }
  /* AOE半径：优先武器"范围"字段中的数字(1-5)，无武器默认2 */
  function weaponAOERadius(weapon){
    if(weapon){
      var r=String(weapon.范围!=null?weapon.范围:'');
      var m=r.match(/(\d+(?:\.\d+)?)/);
      if(m)return clamp(Math.round(parseFloat(m[1])),1,5);
      if(/溅射|范围|爆炸|全体|aoe/i.test(r))return 2;
    }
    return 2;
  }
  /* 队列回滚：按undo载荷恢复AP/耐力/目标HP/坐标/新增buff */
  function undoPendingAction(state,pa){
    try{
      if(!state||!pa||!pa.undo)return;
      var u=pa.undo;
      var p=getControlledUnit(state);
      if(p){
        if(u.apCost){ p.ap=num(p.ap,0)+num(u.apCost,0); var apMax=p.derived?p.derived.apMax:4; if(p.ap>apMax)p.ap=apMax; }
        if(u.staminaHp){ p.hp=num(p.hp,0)+num(u.staminaHp,0); calcDerived(p); var hpMax=p.derived?p.derived.hpMax:p.hp; if(p.hp>hpMax)p.hp=hpMax; }
        if(u.dx!=null){ p.x=num(p.x,0)-num(u.dx,0); if(p.x<0)p.x=0; }
        if(u.dy!=null){ p.y=num(p.y,0)-num(u.dy,0); if(p.y<0)p.y=0; }
      }
      (u.restores||[]).forEach(function(r){
        var t=state.units[r.idx]; if(!t)return;
        if(r.hp){ t.hp=num(t.hp,0)+num(r.hp,0); calcDerived(t); var hm=t.derived?t.derived.hpMax:t.hp; if(t.hp>hm)t.hp=hm; }
        if(r.buffCut>0&&t.buffs&&t.buffs.length>=r.buffCut){ t.buffs.splice(t.buffs.length-r.buffCut,r.buffCut); }
      });
    }catch(e){ console.warn('[战斗引擎v6] 行动回滚失败',e); }
  }
  /* 删除队列项后按剩余队列重算 标记(闪避/格挡/反击/移动) */
  function requeueMarks(state){
    try{
      var p=getControlledUnit(state); if(!p)return;
      var q=state.pendingActions||[];
      var has=function(t){ return q.some(function(a){return a&&a.type===t;}); };
      p._isDodging=has('dodge');
      p._isCountering=has('counter');
      p._isMoving=has('move');
      if(!has('parry'))p._parryState=null;
    }catch(e){}
  }
  /* 自定义行动 · 投骰类型选择悬浮窗（替代原生prompt） */
  function openRollTypeModal(state,rpText){
    var overlay=HOST.document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML='<div style="background:#f3eefc;border:1px solid rgba(167,139,250,0.5);border-radius:14px;padding:18px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(140,120,200,0.18);font-family:inherit;color:#463f63;"><div style="font-weight:700;margin-bottom:10px;font-size:14px;">自定义行动 · 选择投骰类型</div><div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">RP描述</label><div style="background:rgba(255,255,255,0.6);border-radius:6px;padding:5px 10px;font-size:12px;max-height:80px;overflow:auto;">'+esc(rpText)+'</div></div><div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">投骰类型（不投骰=纯RP）</label><select id="cb-rt-type" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;"><option value="">不投骰（纯RP）</option><option value="r力量">r力量</option><option value="rd敏捷">rd敏捷</option><option value="r智力">r智力</option><option value="r体质">r体质</option><option value="r精神">r精神</option><option value="r魅力">r魅力</option><option value="d20">d20</option><option value="d100">d100</option><option value="3d6">3d6</option></select></div><div style="display:flex;gap:6px;margin-top:12px;"><button id="cb-rt-ok" style="flex:1;background:rgba(167,139,250,0.2);border:1px solid rgba(167,139,250,0.4);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;color:#a78bfa;font-weight:600;">确认</button><button id="cb-rt-cancel" style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;color:#463f63;">取消</button></div></div>';
    HOST.document.body.appendChild(overlay);
    overlay.querySelector('#cb-rt-cancel').onclick=function(){ overlay.remove(); };
    overlay.querySelector('#cb-rt-ok').onclick=function(){ var rt=overlay.querySelector('#cb-rt-type').value; overlay.remove(); doCustomAction(state,rpText,rt); renderAllPanels(); };
  }
  /* 添加敌人 · 表单悬浮窗（替代连环prompt） */
  function openAddEnemyModal(state){
    var overlay=HOST.document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    var input=function(label,id,val){ return '<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;">'+label+'</label><input id="'+id+'" value="'+val+'" style="width:100%;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:6px;padding:5px 10px;font-size:12px;color:#463f63;"></div>'; };
    overlay.innerHTML='<div style="background:#f3eefc;border:1px solid rgba(167,139,250,0.5);border-radius:14px;padding:18px;max-width:340px;width:90%;box-shadow:0 8px 32px rgba(140,120,200,0.18);font-family:inherit;color:#463f63;"><div style="font-weight:700;margin-bottom:10px;font-size:14px;">添加敌人</div>'+input('名称','cb-ae-name','哥布林')+input('HP','cb-ae-hp','30')+input('力量','cb-ae-str','12')+input('敏捷','cb-ae-agi','14')+input('体质','cb-ae-con','10')+'<div style="display:flex;gap:6px;margin-top:12px;"><button id="cb-ae-ok" style="flex:1;background:rgba(167,139,250,0.2);border:1px solid rgba(167,139,250,0.4);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;color:#a78bfa;font-weight:600;">加入战场</button><button id="cb-ae-cancel" style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;color:#463f63;">取消</button></div></div>';
    HOST.document.body.appendChild(overlay);
    overlay.querySelector('#cb-ae-cancel').onclick=function(){ overlay.remove(); };
    overlay.querySelector('#cb-ae-ok').onclick=function(){
      var name=overlay.querySelector('#cb-ae-name').value.trim(); if(!name){ overlay.querySelector('#cb-ae-name').focus(); return; }
      var hp=parseInt(overlay.querySelector('#cb-ae-hp').value,10)||30;
      var str=parseInt(overlay.querySelector('#cb-ae-str').value,10)||12;
      var agi=parseInt(overlay.querySelector('#cb-ae-agi').value,10)||14;
      var con=parseInt(overlay.querySelector('#cb-ae-con').value,10)||10;
      var en2=makeEnemy(name,hp,str,agi,con,8,8,8); calcDerived(en2); state.units.push(en2); state.targetIdx=state.units.length-1;
      addLog(state,name+'加入战场(HP '+hp+')'); saveCombatState(state); renderAllPanels(); overlay.remove();
    };
  }

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
  function countTerrainTypes(terrain){
    if(!terrain||!terrain.cells)return 0;
    var types={}; terrain.cells.forEach(function(row){ row.forEach(function(c){ if(c.type!=='平地')types[c.type]=1; }); }); return Object.keys(types).length;
  }
  function buildBattleSnapshot(state){
    var p=state.units.find(function(u){return u.isPlayer;});
    var enemies=state.units.filter(function(u){return !u.isPlayer;});
    var snap='【战场快照】回合'+state.turn+'\n';
    if(p){ snap+='玩家: '+p.name+' HP'+p.hp+'/'+p.derived.hpMax+' AP'+p.ap+'/'+p.derived.apMax+' 能量'+p.energy+'/'+p.derived.energyMax+' 位置('+p.x+','+p.y+')'; if(p.buffs&&p.buffs.length){ snap+=' buff: '+p.buffs.filter(function(b){return b.turns!==-1;}).map(function(b){return b.name+'('+b.turns+'回合)';}).join(', '); } snap+='\n'; }
    enemies.forEach(function(e){ snap+=e.name+': HP'+e.hp+'/'+e.derived.hpMax+' AP'+e.ap+'/'+e.derived.apMax+' 位置('+e.x+','+e.y+')'; if(e.buffs&&e.buffs.length){ snap+=' buff: '+e.buffs.filter(function(b){return b.turns!==-1;}).map(function(b){return b.name+'('+b.turns+'回合)';}).join(', '); } snap+='\n'; });
    if(enemies.length&&p){ var d=distance(p,enemies[0]); snap+='距离: 玩家↔'+enemies[0].name+'='+d+'米 ('+(inRange(p,enemies[0],p.weaponType)?'可攻击':'超出射程')+(state.terrain&&inLineOfSight(state,p,enemies[0])?'':'·视线受阻')+')\n'; }
    if(state.terrain){ snap+='地形: '+state.terrain.width+'×'+state.terrain.height+' ('+countTerrainTypes(state.terrain)+'类特征)\n'; }
    return snap;
  }

  /* ===== 同层追加（真同层：不写消息体、不append DOM。按类型分流到state，控制台从state重渲染） ===== */
  function scrollChatToBottom(){ try{ var chat=HOST.document.querySelector('#chat'); if(chat)chat.scrollTop=chat.scrollHeight; }catch(e){} }
  async function appendCombatToLayer(text, type){
    var state=getCombatState(); if(!state)return;
    type=type||'log';
    if(type==='log'){ addLog(state, text); }
    saveCombatState(state); renderAllPanels();
    scrollChatToBottom();
  }

  /* ===== 静默调用AI（滑动窗口摘要 + 自适应prompt） ===== */
  async function callAI(report){
    var state=getCombatState(); if(!state)throw new Error('战斗状态不存在');
    var snapshot=buildBattleSnapshot(state);
    /* A8兜底：参战角色lore注入snapshot */
    var loreStr=buildRosterLoreSnippet(state);
    if(loreStr)snapshot+='\n'+loreStr;
    /* <pos> 站位同步：把最新坐标注入AI（system inject） + 同步一行到战报tab */
    var posBlock=buildPositionsBlock(state);
    if(posBlock){
      snapshot+='\n【当前站位（权威）】\n'+posBlock;
      addLog(state,'[站位] '+posBlock.replace(/<\/?pos>/g,'').replace(/\r?\n/g,' ').trim());
    }
    /* A3 滑动窗口：近5回合全文narratives + 更早digests */
    var nas=state.narratives||[];
    var dis=state.digests||[];
    var recentNas=nas.slice(-5);
    var olderDis=dis.length>5?dis.slice(0,dis.length-5):[];
    var history='';
    if(recentNas.length){ history+='\n\n【历回合战报(全文)】\n'+recentNas.map(function(n){return '—— 回合'+n.turn+' ——\n'+n.text;}).join('\n\n'); }
    if(olderDis.length){ history+='\n\n【更早战报摘要】\n'+olderDis.map(function(d){return '回合'+d.turn+': '+d.text;}).join('\n'); }
    /* 自适应prompt：_pendingAIUnits 存放需要AI决策的单位名 */
    var needAIList=state._pendingAIUnits||[];
    var promptTail;
    var posTeach='\n若本回合有角色移动，请在</summary>后输出一行格式为<pos>名称|(x,y)</pos>的站位块（每个角色一行，玩家可写其代号/姓名/或"玩家"二字），前端只读取你回复中最后一次出现的<pos>块并作为回合结束时的最终权威站位。';
    if(needAIList.length){
      promptTail='\n\n请演绎战斗(<content>...</content>)，</content>后生成摘要(<summary>...</summary>)。\n以下单位无前端逻辑，请为其输出行动标签：'+needAIList.join('、')+'。\n格式：<enemy_action>行动者|行动类型|目标|参数</enemy_action> 或 <ally_action>队友名|行动类型|目标|参数</ally_action>。\n不要自行计算数值（命中/伤害/DB/闪避/格挡/AOE全由前端结算）。'+posTeach;
    } else {
      promptTail='\n\n请演绎战斗(<content>...</content>)，</content>后生成摘要(<summary>...</summary>)。\n所有单位均由前端决策，无需输出<enemy_action>/<ally_action>。\n不要自行计算数值（命中/伤害/DB/闪避/格挡/AOE全由前端结算）。'+posTeach;
    }
    var userInput=report+history+promptTail;
    if(typeof generate!=='function')throw new Error('generate函数不可用，请确保酒馆助手已安装');
    var reply=await generate({user_input:userInput,should_silence:true,max_chat_history:3,injects:[{role:'system',content:snapshot,position:'in_chat',depth:0,should_scan:true}]});
    return String(reply);
  }

  /* ===== 净化AI回复（提取<content>叙述，剥所有结构化标签） ===== */
  function cleanAIReply(text){
    var t=String(text||'');
    /* 优先提取 <content>...</content> 作为叙述正文 */
    var cm=t.match(/<content>([\s\S]*?)<\/content>/i);
    if(cm){ t=cm[1]; }
    /* 剥除所有结构化标签（闭合+未闭合到结尾） */
    var stripTags=['enemy_spawn','enemy_action','enemy_skills','enemy_equipment','enemy_logic','enemy_script','ally_spawn','ally_action','ally_skills','ally_equipment','ally_logic','ally_script','skill_register','terrain','summary','update','updatevariable','content'];
    stripTags.forEach(function(tag){
      t=t.replace(new RegExp('<'+tag+'>[\\s\\S]*?</'+tag+'>','gi'),'');
      t=t.replace(new RegExp('<'+tag+'[^>]*>[\\s\\S]*$','gi'),'');
    });
    return t.trim();
  }

  /* ===== HP归零检测（支持isAlly：playerSide=isPlayer||isAlly） ===== */
  function checkCombatEnd(state){
    var playerSide=state.units.filter(function(u){return u.isPlayer||u.isAlly;});
    var enemySide=state.units.filter(function(u){return !u.isPlayer&&!u.isAlly;});
    var playerDead=playerSide.length>0&&playerSide.every(function(u){return u.hp<=0;});
    var noPlayerSide=playerSide.length===0;
    var allDead=enemySide.length>0&&enemySide.every(function(u){return u.hp<=0;});
    if(playerDead||noPlayerSide||allDead){
      state.phase='COMBAT_END'; state.active=false;
      var msg=allDead?'所有敌人被击败，战斗胜利！':(playerDead?'我方全军覆没，战斗失败！':'我方无战斗单位！');
      addLog(state,'-- '+msg+' --');
      saveCombatState(state); renderAllPanels();
      /* 战斗结束：将战斗消息替换为摘要，移除CombatHud，回归非同层 */
      finalizeCombatMessage(state, msg);
      return true;
    }
    return false;
  }

  /* ===== 战斗结束：将战斗消息体替换为摘要（移除<CombatHud/>，回归非同层对话） ===== */
  async function finalizeCombatMessage(state, endMsg){
    if(!state)return;
    /* [FIX] 立即进入结束态：消灭手动结束后 ~1.5s 内 state.active 仍为 true 的残留窗口 */
    state.active=false; state.phase='COMBAT_END';
    try{ saveCombatState(state); }catch(e0){}
    try{ renderAllPanels(); }catch(e0b){}
    var digests=state.digests||[];
    var summary='═══ 战斗记录 · '+endMsg+' ═══\n\n';
    if(digests.length){
      digests.forEach(function(dg){ summary+='【回合'+dg.turn+'·'+(dg.title||'战报')+'】\n'+dg.text+'\n\n'; });
    } else {
      /* 无digest时用日志摘要 */
      var logs=(state.log||[]).filter(function(e){return e.text&&e.text.indexOf('回合')>=0;});
      logs.slice(-10).forEach(function(e){ summary+=e.text+'\n'; });
    }
    summary+='\n（战斗结束，继续剧情对话）';
    var fullMsg='<content>战斗结束</content>\n<summary>'+summary+'</summary>';
    /* [FIX] 继承最近一条带 stat_data 楼层的变量（并置 主页.战斗中=false）随摘要楼层一起写入：
       1) MVU 变量链在新楼层不断档，状态栏 HUD 不再读到陈旧数据；
       2) 战斗标记随楼层正确落盘，状态栏不会因读到旧的 战斗中=true 而自动重召战斗 */
    var carrySd=null;
    try{
      var baseSd=(typeof fetchStatData==='function')?fetchStatData():null;
      if(baseSd){ carrySd=JSON.parse(JSON.stringify(baseSd)); if(carrySd&&carrySd['主页'])carrySd['主页']['战斗中']=false; }
    }catch(eSd){ carrySd=null; }
    /* [FIX] 战斗消耗回写：玩家战斗后的 HP(耐力)/能量 同步进随摘要楼层写入的 stat_data，
       状态栏档案页/商城读到的不再是一战前的旧值 */
    try{
      var pu=state.units.find(function(u){return u.isPlayer;});
      if(pu&&carrySd){
        var da=carrySd['个人档案']||(carrySd['个人档案']={});
        var dsy=da['衍生属性']||(da['衍生属性']={});
        var hpO=dsy['生命值']||(dsy['生命值']={});
        hpO['当前']=Math.max(0,Math.round(num(pu.hp,0)));
        var hpMaxV=num(pu.hpMaxBase,0); if(hpMaxV>0)hpO['最大']=Math.round(hpMaxV);
        var enO=dsy['能量值']||(dsy['能量值']={});
        enO['当前']=Math.max(0,Math.round(num(pu.energy,0)));
      }
    }catch(eWb){ console.error('[战斗引擎v6] 战斗消耗回写失败',eWb); }
    /* 发送摘要战报到新楼层（含 <content> 保证伪同层正常解析，避免空楼层） */
    try{
      if(typeof createChatMessages==='function'){
        var endMsgObj={role:'assistant',message:fullMsg};
        if(carrySd)endMsgObj.data={stat_data:carrySd};
        await createChatMessages([endMsgObj],{refresh:'affected'});
      }
    }catch(e){ console.error('[战斗引擎v6] 战斗摘要发送失败',e); }
    /* 延迟清除：引擎状态 + MVU 战斗中标记 一起置 false，避免控制台/怪物残留与自动重召唤 */
    setTimeout(function(){
      try{ clearCombatState(); renderAllPanels(); }catch(e){}
      try{
        var lid=(typeof lastMsgIdSafe==='function')?lastMsgIdSafe():null;
        if(lid!==null && typeof getVariables==='function' && typeof insertOrAssignVariables==='function'){
          var vv=getVariables({type:'message',message_id:lid});
          var sdd=vv && vv.stat_data;
          if(sdd && sdd['主页']){ sdd['主页']['战斗中']=false; insertOrAssignVariables({stat_data:sdd},{type:'message',message_id:lid}); }
        }
      }catch(e2){ console.error('[战斗引擎v6] 清除MVU战斗标记失败',e2); }
    }, 1500);
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

  /* ===== 执行玩家行动（同层闭环 + 混合callAI） ===== */
  async function executePlayerAction(state, report){
    state.phase='AI_GENERATING'; saveCombatState(state); renderAllPanels();
    /* 战报入日志tab，不写消息体 */
    try{ await appendCombatToLayer(report,'log'); }catch(e){ console.error('[战斗引擎v6] 追加战报失败',e); }
    if(checkCombatEnd(state))return;

    /* 混合模式：遍历所有AI/队友单位，有logic/script的由前端decideUnitAction结算。跳过玩家当前操控的单位。 */
    var aiUnits=state.units.filter(function(u){return !u.isPlayer&&u.hp>0&&u.id!==state.controlledUnitId;});
    var needAI=[]; var frontendReports=[];
    aiUnits.forEach(function(u){
      var hasLogic=(u.logic||u.script);
      if(hasLogic){
        try{
          var dec=decideUnitAction(state,u);
          if(dec){
            var r=resolveUnitDecision(state,u,dec);
            if(r)frontendReports.push(r);
          }
        }catch(e){ console.warn('[战斗引擎v6] '+u.name+'前端决策失败，转交AI',e); needAI.push(u.name); }
      } else {
        needAI.push(u.name);
      }
    });
    if(frontendReports.length){ addLog(state,'【AI/队友前端决策结算】\n'+frontendReports.join('\n---\n')); }
    state._pendingAIUnits=needAI;
    saveCombatState(state); renderAllPanels();
    if(checkCombatEnd(state))return;

    /* 调AI：演绎+digest+(仅needAI单位的action) */
    var reply;
    try{ reply=await callAI(report); }catch(e){ addLog(state,'AI调用失败: '+(e&&e.message||e)); console.error('[战斗引擎v6] AI调用失败',e); state.phase='PLAYER_ACTING'; saveCombatState(state); renderAllPanels(); return; }
    await processAIReply(state, reply);
  }

  /* 结算decideUnitAction返回的决策（攻击/技能/移动/防御/逃跑等） */
  function resolveUnitDecision(state, unit, dec){
    if(!dec||!dec.action)return null;
    var action=dec.action;
    if(action==='攻击'||action==='普通攻击'){
      var tgt=dec.target||getMainTarget(state,unit);
      if(!tgt||tgt.hp<=0)return unit.name+'无有效目标';
      var r=resolveAttack(unit,tgt,state,{});
      var apCost=(unit.weaponType==='twohand')?3:2; costAP(unit,apCost);
      addLog(state,r.summary); return r.summary;
    }
    if(action==='技能'&&dec.skill){
      return resolveUnitSkill(state,unit,dec.skill,dec.target);
    }
    if(action==='闪避'){ markDodge(unit); return unit.name+'闪避(待结算)'; }
    if(action==='防御'||action==='等待'){ return unit.name+'防御姿态'; }
    if(action==='移动'){
      var tgt2=dec.target||getMainTarget(state,unit);
      if(tgt2){ var dx=tgt2.x-unit.x, dy=tgt2.y-unit.y; var spd=num(unit.derived&&unit.derived.moveSpeed,3); if(Math.abs(dx)>Math.abs(dy)){ unit.x+=clamp(dx,-spd,spd); } else { unit.y+=clamp(dy,-spd,spd); } }
      costAP(unit,1); return unit.name+'移动到('+unit.x+','+unit.y+')';
    }
    if(action==='逃跑'){ addLog(state,unit.name+'试图逃跑'); return unit.name+'试图逃跑'; }
    return unit.name+'执行:'+action;
  }
  /* AI/队友使用技能结算（简化版，复用玩家技能逻辑） */
  function resolveUnitSkill(state, unit, skillName, target){
    var d=fetchStatData(); var mvuSkills=d?readSkillCards(d):{}; var localS=getSkillConfig();
    var skill=mvuSkills[skillName]||localS[skillName]||(unit._skills&&unit._skills[skillName]);
    if(!skill)return unit.name+'技能不存在:'+skillName;
    var apCost=num(skill.AP消耗||skill.apCost,2);
    if(unit.ap<apCost){ return unit.name+'AP不足('+skillName+')'; }
    var isSelf=(String(skill.范围||skill.rangeType||'').indexOf('self')>=0);
    var tgt=target;
    if(!isSelf&&!tgt){ tgt=getMainTarget(state,unit); }
    var actionStr=unit.name+'使用技能: '+skillName+'\n';
    var hitExpr=skill.hitExpr||'';
    if(!hitExpr&&skill.伤害){ hitExpr=(String(skill.伤害类型||'物理')==='魔法')?'r智力':'r力量'; }
    var hit=null;
    if(hitExpr){ hit=nebDice(hitExpr,unit,'attack'); }
    if(!isSelf&&tgt&&hit){
      var dodge=nebDice('rd敏捷',tgt,'dodge');
      var hitSuccess=hit.total>dodge.total;
      actionStr+=tgt.name+'闪避='+dodge.total+' → '+(hitSuccess?'命中':'未命中')+'\n';
      if(hitSuccess&&skill.伤害){
        var dmgType=skill.伤害类型||'物理';
        var dmg=nebDice(skill.伤害,unit,'damage');
        var dmgDealt=dmg.total;
        if(dmg.crit||hit.crit)dmgDealt=dmg.total*2;
        if(dmgType==='物理')dmgDealt=Math.max(1,dmgDealt-tgt.derived.physDef);
        else if(dmgType==='魔法')dmgDealt=Math.max(1,dmgDealt-tgt.derived.mystDef);
        tgt.hp-=dmgDealt; if(tgt.hp<0)tgt.hp=0;
        actionStr+='伤害='+dmgDealt+' '+tgt.name+' HP→'+tgt.hp+'\n';
      }
    }
    unit.ap-=apCost; unit.hp-=apCost*5; if(unit.hp<0)unit.hp=0;
    if(!unit.cooldowns)unit.cooldowns={}; var cd=num(skill.冷却||skill.cooldown,0); if(cd>0)unit.cooldowns[skillName]=cd;
    return actionStr;
  }

  /* ===== 处理AI回复（叙事/digest/spawn/action 全分流到state） ===== */
  async function processAIReply(state, reply){
    /* A6: 解析地形 */
    var terrain=parseTerrain(reply);
    if(terrain){ state.terrain=terrain; addLog(state,'★ 战场地形已加载: '+terrain.width+'×'+terrain.height); }
    /* 敌方生成（6属性，向后兼容4属性） */
    var spawns=parseEnemySpawn(reply);
    if(spawns.length){
      spawns.forEach(function(s){
        var en=makeEnemy(s.name,s.hp,s.str,s.agi,s.con,s.int||8,s.spi||8,s.cha||8);
        calcDerived(en); state.units.push(en);
        addToRosterFromSpawn(s,'enemy',reply);
        addLog(state,'★ 敌方援军: '+s.name+' HP'+s.hp);
      });
    }
    /* 队友生成 */
    var allySpawns=parseAllySpawn(reply);
    if(allySpawns.length){
      allySpawns.forEach(function(s){
        var al=makeAlly(s.name,s.hp,s.str,s.agi,s.con,s.int||8,s.spi||8,s.cha||8);
        var logic=parseAllyLogic(reply); if(logic)al.logic=logic;
        var script=parseScriptBlock(reply,'ally_script'); if(script)al.script=script;
        calcDerived(al); state.units.push(al);
        addToRosterFromSpawn(s,'ally',reply);
        addLog(state,'★ 队友加入: '+s.name+' HP'+s.hp);
      });
    }
    /* digest 摘要 → 战报存档 */
    var digest=parseDigest(reply);
    if(digest){ if(!state.digests)state.digests=[]; state.digests.push({turn:state.turn,title:digest.title,text:digest.text}); }
    /* 叙述正文 → 正文tab当回合 + narratives累积 */
    var cleanText=cleanAIReply(reply);
    if(cleanText){ state._narrativeText=cleanText; if(!state.narratives)state.narratives=[]; state.narratives.push({turn:state.turn,text:cleanText}); }
    saveCombatState(state); renderAllPanels();
    if(checkCombatEnd(state))return;

    /* 仅无logic单位的敌方行动（由AI输出<enemy_action>） */
    var actions=parseEnemyAction(reply);
    if(actions.length>0){
      state.phase='ENEMY_RESOLVING'; saveCombatState(state); renderAllPanels();
      var reports=[];
      actions.forEach(function(ea){ var r=resolveEnemyAction(state,ea); if(r)reports.push(r); });
      if(reports.length){ addLog(state,'【敌方行动结算】\n'+reports.join('\n---\n')); }
    }
    /* 仅无logic的队友行动（由AI输出<ally_action>） */
    var allyActions=parseAllyAction(reply);
    if(allyActions.length>0){
      var allyReports=[];
      allyActions.forEach(function(aa){ var r=resolveAllyAction(state,aa); if(r)allyReports.push(r); });
      if(allyReports.length){ addLog(state,'【队友行动结算】\n'+allyReports.join('\n---\n')); }
    }
    if(checkCombatEnd(state))return;
    /* 最后应用AI回复中的<pos>（取最后一次出现），作为回合结束时的权威站位，
       覆盖 enemy_action/ally_action 增量移动之后的结果 */
    applyPositions(state,reply);
    state._pendingAIUnits=null;
    tick(state);
    state.phase='PLAYER_ACTING'; saveCombatState(state); renderAllPanels();
  }

  /* ===== 自定义行动 ===== */
  function doCustomAction(state, rpText, rollType){
    var p=getControlledUnit(state); if(!p)return;
    var action='';
    if(rollType&&rollType!=='none'&&rollType!==''){ if(p)calcDerived(p); var r=nebDice(rollType,p,'custom'); action='自由投骰: '+rollType+'\n'+r.detail+' = '+r.total+(r.crit?' [大成功]':'')+(r.fumble?' [大失败]':''); }
    var report=buildReport(state,action,rpText,'自定义行动');
    addLog(state,report);
    addActionToQueue(state,{type:'custom',report:action,rpText:rpText});
  }

  /* ===== QR召唤战斗会话（扩展：上下文扫描敌人） ===== */
  async function startCombatSession(enemyName, enemyHp, enemyStr, enemyAgi, enemyCon){
    var d=fetchStatData();
    var state={turn:1,units:[],log:[],phase:'PLAYER_ACTING',active:true,targetIdx:1,combatMessageId:null,pendingActions:[],narratives:[],digests:[],terrain:null,controlledUnitId:'player'};
    if(d){ var p=seedPlayer(d); calcDerived(p); state.units.push(p); }
    else{ var p2=makeEnemy('玩家',40,12,12,12,12,12,12); p2.isPlayer=true; p2.id='player'; calcDerived(p2); state.units.push(p2); }
    if(enemyName){ var enemy=makeEnemy(enemyName,enemyHp||30,enemyStr||12,enemyAgi||14,enemyCon||10,8,8,8); calcDerived(enemy); state.units.push(enemy); }
    addLog(state,'-- 战斗开始 · 回合1 --');
    saveCombatState(state);
    var initReport=buildReport(state,'战斗开始！'+state.units.map(function(u){return u.name+' HP'+u.hp+'/'+u.derived.hpMax;}).join(' vs '),'','战斗开始');
    addLog(state,initReport);
    /* 不注入新楼层：战斗面板由复合控制台挂载到当前楼层 */
    saveCombatState(state);
  }

  /* ======================================================================
   * 伤害计算管线 (Damage Calculation Pipeline)
   * 基础(装备/技能) + 增伤 + 属性提升(buff roll) + 类型防御 + 暴击 + 特殊
   * ====================================================================== */
  /* 专精命中加成：F底，每小阶+d4，每大阶+3。阶位映射 F<F-<E<E-<D<D-<C<C-<B<B-<A<A-<S */
  function profBonus(prof){
    if(!prof||typeof prof!=='string')return 0;
    var order=['F','F-','E','E-','D','D-','C','C-','B','B-','A','A-','S'];
    var idx=order.indexOf(prof.toUpperCase());
    if(idx<0)return 0;
    /* 每小阶+1d4，每大阶(跨越 '-')额外+3 */
    var smallSteps=idx; /* 0..12 */
    var bigSteps=Math.floor((idx+1)/2);
    return smallSteps+'d4+'+(bigSteps*3);
  }
  function resolveAttack(att, def, state, options){
    options=options||{};
    var damageType=options.damageType||(att.atkType==='magic'?'魔法':'物理');
    var hitExpr=options.hitExpr||((damageType==='魔法')?'r智力':'r力量');
    var damageExpr=options.damageExpr||'d4+DB';
    var critThreshold=options.critThreshold||20;
    var critMult=options.critMultiplier||2;
    var isSummon=options.isSummon||false; /* 召唤技能必中 */

    /* A9: 射击/技能专精命中加成 */
    var profHitBonus='';
    if(options.proficiency){ var pb=profBonus(options.proficiency); if(pb)profHitBonus='+'+pb; }
    else if(options.weaponType==='pistol'||options.weaponType==='shotgun'){
      var sp=att.专精&&att.专精['射击']; if(sp){ var pb2=profBonus(sp); if(pb2)profHitBonus='+'+pb2; }
    }
    /* A6: 地形命中加成（高地等） */
    var terrainMods=getTerrainAttackMods(state,att,def);
    if(terrainMods.hitBonus)profHitBonus+=terrainMods.hitBonus;

    var hit=nebDice(hitExpr+(profHitBonus||''), att, 'attack');

    /* A9: 消费目标的闪避/格挡标记（修复doDodge/doParry/doCounter生效bug） */
    var dodgeRoll=consumeDodge(def);
    var parryState=consumeParry(def);
    var dodge;
    if(dodgeRoll){ dodge=dodgeRoll; }
    else { dodge=nebDice('rd敏捷', def, 'dodge'); }

    /* A9: 移动闪避减半 */
    if(def._isMoving){ dodge.total=Math.floor(dodge.total/2); dodge.detail+=' (移动闪避减半)'; }

    /* A9: 召唤技能必中 */
    var hitSuccess=isSummon?true:(hit.total>dodge.total);

    var dmg=null, dmgDealt=0, hpBefore=def.hp, dmgBreakdown='';

    if(hitSuccess){
      /* Build damage context with all active damage mods */
      var dmgCtx=buildBuffedContext(att, 'damage');
      if(options.triggeredEffects){
        options.triggeredEffects.forEach(function(eff){
          if(eff.effect==='roll_mod'&&eff.rollTarget==='damage'){ damageExpr=damageExpr+'+'+eff.formula; }
        });
      }
      (att.buffs||[]).forEach(function(b){
        if(b.effect==='roll_mod'&&b.rollTarget==='damage'&&b.turns!==0){ damageExpr=damageExpr+'+'+b.formula; }
      });
      dmg=nebDice(damageExpr, att, 'damage');
      dmgDealt=dmg.total;
      var isCrit=hit.crit||dmg.crit||(hit.total>=critThreshold&&critThreshold<20);
      if(isCrit){ dmgDealt=Math.floor(dmg.total*critMult); }

      /* A9: 格挡减伤（消费parryState） */
      if(parryState){
        if(parryState.roll> hit.total+parryState.threshold){
          /* 完全格挡 */
          dmgDealt=0; dmgBreakdown='伤害 '+dmg.detail+'='+dmg.total+' → [格挡成功·完全格挡] '+def.name+' HP '+hpBefore+'→'+def.hp;
          var summary0=att.name+'('+damageType+') → '+def.name+'\n命中 '+hit.detail+'='+hit.total+'\n格挡 [d'+parryState.base+'='+parryState.roll+'] > 命中'+parryState.threshold+' → 完全格挡\n'+def.name+' HP '+hpBefore+'→'+def.hp;
          return {summary:summary0,hit:hit,dodge:dodge,dmg:dmg,dmgDealt:0,hitSuccess:true,target:def,damageType:damageType,parried:true};
        } else {
          dmgDealt=Math.floor(dmgDealt*(1-parryState.reduceRate));
        }
      }

      if(damageType==='物理'){ dmgDealt=Math.max(1, dmgDealt-def.derived.physDef); }
      else if(damageType==='魔法'){ dmgDealt=Math.max(1, dmgDealt-def.derived.mystDef); }
      /* A6: 地形掩体减伤 */
      if(terrainMods.dmgReduce>0){ dmgDealt=Math.max(1,Math.floor(dmgDealt*(1-terrainMods.dmgReduce))); }

      dmgBreakdown='伤害 '+dmg.detail+'='+dmg.total;
      if(isCrit)dmgBreakdown+=' [暴击×'+critMult+'='+dmgDealt+']';
      if(parryState)dmgBreakdown+=' [格挡减伤'+(parryState.reduceRate*100)+'%→'+dmgDealt+']';
      if(damageType==='物理')dmgBreakdown+=' → 物理减防(-'+def.derived.physDef+')='+dmgDealt;
      else if(damageType==='魔法')dmgBreakdown+=' → 魔法减防(-'+def.derived.mystDef+')='+dmgDealt;
      else dmgBreakdown+=' → 真实伤害(不减)='+dmgDealt;
      if(terrainMods.extraLog)dmgBreakdown+=terrainMods.extraLog;

      def.hp-=dmgDealt; if(def.hp<0)def.hp=0;
    }

    var summary=att.name+'('+damageType+(isSummon?'·召唤必中':'')+(profHitBonus?'·专精':'')+') → '+def.name+'\n'+
      '命中 '+hit.detail+'='+hit.total+(hit.crit?' [大成功]':'')+(hit.fumble?' [大失败]':'')+'\n'+
      '闪避 '+dodge.detail+'='+dodge.total+(dodge.fumble?' [大失败]':'')+(def._isMoving?' [移动减半]':'')+'\n'+
      '→ '+(hitSuccess?'命中':'未命中');
    if(hitSuccess&&dmg){ summary+='\n'+dmgBreakdown+'\n'+def.name+' HP '+hpBefore+'→'+def.hp; }
    /* A9: 反击 — 防御者放弃闪避，受击时反击攻击者 */
    if(def._isCountering&&hitSuccess&&def.hp>0){
      var ctr=nebDice('r力量',def,'attack');
      var ctrDmg=nebDice('d4+DB',def,'damage');
      var ctrDealt=Math.max(1,ctrDmg.total-(att.derived?att.derived.physDef:0));
      att.hp-=ctrDealt; if(att.hp<0)att.hp=0;
      summary+='\n[反击] '+def.name+' 反击 '+att.name+' 命中='+ctr.total+' 伤害='+ctrDealt+' → '+att.name+' HP '+att.hp;
      def._isCountering=false;
    }
    return {summary:summary,hit:hit,dodge:dodge,dmg:dmg,dmgDealt:dmgDealt,hitSuccess:hitSuccess,target:def,damageType:damageType};
  }

  /* A9: AOE三层闪避：闪避>命中+2n不受伤；命中<闪避≤命中+2n减半；闪避≤命中全额；范围>目标敏捷必中 */
  function resolveAOEAttack(att, targets, state, options){
    options=options||{};
    var results=[];
    var damageType=options.damageType||(att.atkType==='magic'?'魔法':'物理');
    var hitExpr=options.hitExpr||((damageType==='魔法')?'r智力':'r力量');
    var damageExpr=options.damageExpr||'d4+DB';
    var aoeRadius=options.aoeRadius||2;
    var hit=nebDice(hitExpr, att, 'attack');
    targets.forEach(function(def){
      if(def.hp<=0)return;
      var dodge=nebDice('rd敏捷', def, 'dodge');
      if(def._isMoving){ dodge.total=Math.floor(dodge.total/2); }
      /* 范围>目标敏捷 必中 */
      var forceHit=aoeRadius>num(def.eff&&def.eff['敏捷'],10);
      var hitSuccess, dmgDealt=0, hpBefore=def.hp, dmg=null;
      if(forceHit){ hitSuccess=true; }
      else if(dodge.total> hit.total+2*aoeRadius){ hitSuccess=false; } /* 闪避>命中+2n 不受伤 */
      else { hitSuccess=true; } /* 命中<闪避≤命中+2n 减半 / 闪避≤命中 全额 */
      var isHalf=(!forceHit)&&dodge.total>hit.total; /* 减半层 */
      if(hitSuccess){
        dmg=nebDice(damageExpr, att, 'damage');
        dmgDealt=dmg.total;
        if(dmg.crit||hit.crit)dmgDealt=Math.floor(dmg.total*2);
        if(damageType==='物理')dmgDealt=Math.max(1,dmgDealt-def.derived.physDef);
        else if(damageType==='魔法')dmgDealt=Math.max(1,dmgDealt-def.derived.mystDef);
        if(isHalf)dmgDealt=Math.floor(dmgDealt/2);
        def.hp-=dmgDealt; if(def.hp<0)def.hp=0;
      }
      var s=att.name+'(AOE·'+damageType+') → '+def.name+'\n命中='+hit.total+' 闪避='+dodge.total+(forceHit?' [范围必中]':'')+(isHalf?' [边缘减半]':'')+'\n→ '+(hitSuccess?'命中 伤害='+dmgDealt:'未命中')+'\n'+def.name+' HP '+hpBefore+'→'+def.hp;
      results.push(s);
    });
    return results;
  }
  /* ===== 玩家攻击（持械动态计价 + 双持自动流程 + AOE武器半径 + 队列可回滚） ===== */
  function doPlayerAttack(state, targetIdx, isAOE, aoeRadius, rpText){
    var p=getControlledUnit(state); if(!p||p.hp<=0)return;
    var d=fetchStatData();
    var equipCards=d?readEquipmentCards(d):{};
    var weaponName=p.equippedSlots?p.equippedSlots['武器']:null;
    var weapon=weaponName?equipCards[weaponName]:null;

    var hitExpr='r力量', damageExpr='d4+DB', damageType='物理', critThreshold=20, critMult=2;
    var triggeredEffects=[];
    var weaponType=p.weaponType||'onehand';
    if(weapon){
      if(weapon.伤害)damageExpr=weapon.伤害;
      if(weapon.伤害类型)damageType=weapon.伤害类型;
      critThreshold=20; critMult=2;
      (weapon._effects||[]).forEach(function(eff){
        if(eff.effect==='roll_mod'&&eff.rollTarget==='damage')triggeredEffects.push(eff);
        if(eff.effect==='debuff_apply')triggeredEffects.push(eff);
      });
    }
    if(p.atkType==='magic'){ hitExpr='r智力'; if(!weapon)damageType='魔法'; }

    /* 持械动态计价：单手2 / 双持4(自动走双持流程) / 双手3(力量不达标+1) */
    var am=getAttackMode(p,d);
    if(am.mode==='dual'&&!isAOE){ return doDualWield(state,targetIdx,rpText); }
    var apCost=isAOE?((weaponType==='twohand')?3:2):am.apCost;

    if(p.ap<apCost){ addLog(state,'AP不足（需'+apCost+'）'); if(typeof toastr!=='undefined')toastr.warning('AP不足（需'+apCost+'AP），无法'+(isAOE?'AOE攻击':'攻击')); saveCombatState(state); renderAllPanels(); return; }

    if(isAOE){
      /* AOE半径：优先调用方指定(1-5)，否则按武器"范围"数据自动确定，不再询问玩家 */
      var radius=(aoeRadius!=null&&!isNaN(parseFloat(aoeRadius)))?clamp(Math.round(num(aoeRadius,2)),1,5):weaponAOERadius(weapon);
      var targets=unitsInAOE(p,radius,state.units.filter(function(u){return !u.isPlayer&&!u.isAlly;}));
      if(!targets.length){ addLog(state,'AOE范围内无目标（半径'+radius+'格）'); if(typeof toastr!=='undefined')toastr.warning('AOE半径'+radius+'格内没有敌人，先靠近目标！'); saveCombatState(state); return; }
      var tIdx=targets.map(function(t){return state.units.indexOf(t);});
      var hpB=targets.map(function(t){return t.hp;});
      var bfB=targets.map(function(t){return (t.buffs||[]).length;});
      var allResults=resolveAOEAttack(p,targets,state,{hitExpr:hitExpr,damageExpr:damageExpr,damageType:damageType,critThreshold:critThreshold,critMultiplier:critMult,triggeredEffects:triggeredEffects,aoeRadius:radius,weaponType:weaponType});
      var hit=nebDice(hitExpr,p,'attack');
      var actionStr='AOE攻击(半径'+radius+'格) 命中'+hitExpr+'='+hit.total+(hit.crit?'(大成功)':'')+(hit.fumble?'(大失败)':'')+'\n';
      allResults.forEach(function(s){ actionStr+=s+'\n'; });
      costAP(p,apCost);
      actionStr+='消耗'+apCost+'AP/'+(apCost*5)+'HP(耐力)';
      var report=buildReport(state,actionStr,rpText,'AOE攻击');
      addLog(state,report);
      addActionToQueue(state,{type:'aoe',report:actionStr,rpText:rpText,undo:{apCost:apCost,staminaHp:apCost*5,restores:targets.map(function(t,i){return {idx:tIdx[i],hp:hpB[i]-t.hp,buffCut:((t.buffs||[]).length)-bfB[i]};})}});
      return;
    }

    var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer&&!u.isAlly;});
    if(!def||def.hp<=0){ addLog(state,'无有效目标'); if(typeof toastr!=='undefined')toastr.warning('没有可攻击的目标'); saveCombatState(state); return; }
    if(!inRange(p,def,weaponType)){ addLog(state,'目标超出射程！距离='+distance(p,def)+'米'); if(typeof toastr!=='undefined')toastr.warning('目标超出射程（距离'+distance(p,def)+'米），先用 走/跑 靠近！'); saveCombatState(state); renderAllPanels(); return; }

    var defIdx=state.units.indexOf(def);
    var hpBefore=def.hp; var buffsBefore=(def.buffs||[]).length;
    var r=resolveAttack(p,def,state,{hitExpr:hitExpr,damageExpr:damageExpr,damageType:damageType,critThreshold:critThreshold,critMultiplier:critMult,triggeredEffects:triggeredEffects,weaponType:weaponType});
    costAP(p,apCost);
    var actionStr=r.summary+'\n消耗'+apCost+'AP/'+(apCost*5)+'HP(耐力) | AP->'+p.ap;
    if(weapon&&r.hitSuccess){
      (weapon._effects||[]).forEach(function(eff){
        if(eff.effect==='debuff_apply'){
          if(!def.buffs)def.buffs=[];
          def.buffs.push({name:eff.name,effect:'debuff_apply',formula:eff.formula,turns:eff.duration||2,target:'enemy'});
          actionStr+='\n'+def.name+'获得'+eff.name+'('+eff.duration+'回合)';
        }
      });
    }
    var report=buildReport(state,actionStr,rpText,damageType==='魔法'?'法术攻击':'物理攻击');
    addLog(state,report);
    addActionToQueue(state,{type:'attack',report:actionStr,rpText:rpText,undo:{apCost:apCost,staminaHp:apCost*5,restores:[{idx:defIdx,hp:hpBefore-def.hp,buffCut:((def.buffs||[]).length)-buffsBefore}]}});
  }

  /* ===== 闪避/格挡/移动/自由投骰 — 加入pendingActions + 标记效果(A9修复生效) ===== */
  function doDodge(state, rpText){
    var p=getControlledUnit(state); if(!p||p.ap<1){ addLog(state,'AP不足（需1）'); if(typeof toastr!=='undefined')toastr.warning('AP不足（需1AP），无法闪避'); saveCombatState(state); return; }
    costAP(p,1); markDodge(p); /* A9: 标记闪避，resolveAttack时消费 */
    var action='玩家闪避(已标记，受击时结算) \n消耗1AP/5HP(耐力) | AP->'+p.ap;
    var report=buildReport(state,action,rpText,'闪避'); addLog(state,report);
    addActionToQueue(state,{type:'dodge',report:action,rpText:rpText,undo:{apCost:1,staminaHp:5}});
  }
  function doParry(state, ptype, rpText){
    var p=getControlledUnit(state); if(!p||p.ap<1){ addLog(state,'AP不足（需1）'); if(typeof toastr!=='undefined')toastr.warning('AP不足（需1AP），无法格挡'); saveCombatState(state); return; }
    costAP(p,1); markParry(p,ptype); /* A9: 标记格挡，resolveAttack时消费 */
    var label={weapon:'武器格挡',shield2h:'双手盾格挡',shield1h:'单手盾格挡',barehand:'空手格挡'}[ptype]||'格挡';
    var action='玩家'+label+'(已标记，受击时结算) \n消耗1AP/5HP(耐力) | AP->'+p.ap;
    var report=buildReport(state,action,rpText,label); addLog(state,report);
    addActionToQueue(state,{type:'parry',report:action,rpText:rpText,undo:{apCost:1,staminaHp:5}});
  }
  function doMove(state, mode, rpText){
    var p=getControlledUnit(state); if(!p)return;
    var apCost=(mode==='run')?2:1; if(p.ap<apCost){ addLog(state,'AP不足（需'+apCost+'）'); if(typeof toastr!=='undefined')toastr.warning('AP不足（需'+apCost+'AP），无法移动'); saveCombatState(state); return; }
    var spd=Math.floor(num(p.eff['敏捷'],10)/5); var dist=(mode==='run')?spd*3:spd;
    var prevX=p.x, prevY=p.y;
    if(mode==='run'){ p.hp-=40; if(p.hp<0)p.hp=0; } costAP(p,apCost);
    p._isMoving=true; /* A9: 移动状态受击闪避减半，下回合tick清除 */
    /* A6: 如果有地形且有目标，用pathfind移动；否则朝目标方向直线移动 */
    var moved=0;
    if(state.terrain&&state.targetIdx!=null&&state.units[state.targetIdx]){
      var tgt=state.units[state.targetIdx];
      var path=pathfind(state,{x:p.x,y:p.y},{x:tgt.x,y:tgt.y});
      if(path&&path.length>1){
        for(var pi=1;pi<path.length&&moved<dist;pi++){
          p.x=path[pi].x; p.y=path[pi].y; moved++;
          triggerTrap(state,p); /* A6: 移动触发陷阱 */
        }
      }
    } else {
      /* 无地形：朝当前目标方向移动（修复原来只能朝+x方向移动的问题） */
      var tgt2=state.units[state.targetIdx];
      if(tgt2&&tgt2!==p){
        var dx=tgt2.x-p.x, dy=tgt2.y-p.y;
        var half=Math.floor(dist/2);
        if(Math.abs(dx)>=Math.abs(dy)){
          p.x=clamp(p.x+(dx>0?dist:(dx<0?-dist:0)),Math.min(p.x,tgt2.x),Math.max(p.x,tgt2.x));
          p.y=clamp(p.y+(dy>0?half:(dy<0?-half:0)),Math.min(p.y,tgt2.y),Math.max(p.y,tgt2.y));
        } else {
          p.y=clamp(p.y+(dy>0?dist:(dy<0?-dist:0)),Math.min(p.y,tgt2.y),Math.max(p.y,tgt2.y));
          p.x=clamp(p.x+(dx>0?half:(dx<0?-half:0)),Math.min(p.x,tgt2.x),Math.max(p.x,tgt2.x));
        }
      } else { p.x=clamp(p.x+dist,0,99); }
      moved=dist;
    }
    var label=(mode==='run')?'跑步':'走路';
    var action='玩家'+label+' 移动'+moved+'米'+(mode==='run'?' (额外消耗40HP)':'')+'\n消耗'+apCost+'AP/'+((apCost*5)+(mode==='run'?40:0))+'HP(耐力) | AP->'+p.ap;
    var report=buildReport(state,action,rpText,label); addLog(state,report);
    addActionToQueue(state,{type:'move',report:action,rpText:rpText,undo:{apCost:apCost,staminaHp:apCost*5+(mode==='run'?40:0),dx:p.x-prevX,dy:p.y-prevY}});
  }
  function doFreeRoll(state, expr, rpText){
    var p=getControlledUnit(state); if(p)calcDerived(p);
    var r=nebDice(expr,p,'custom');
    var action='自由投骰: '+expr+'\n'+r.detail+' = '+r.total+(r.crit?' [大成功]':'')+(r.fumble?' [大失败]':'');
    var report=buildReport(state,action,rpText,'自由投骰'); addLog(state,report);
    saveCombatState(state); renderAllPanels();
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
    var p=getControlledUnit(state); if(!p||p.hp<=0)return;
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

    /* Hit roll — A9: 技能专精命中加成 + 召唤必中 */
    var hit=null;
    var hitExpr=skill.hitExpr||'';
    if(!hitExpr && skill.伤害){ hitExpr=(String(skill.伤害类型||'物理')==='魔法')?'r智力':'r力量'; }
    var isSummonSkill=(skill.type==='召唤'||skill.动作类型==='召唤');
    /* A9: 技能专精命中加成（技能专精>技能等级每级+d5，高2级固定+5） */
    var skillProfBonus='';
    if(skill.专精){ skillProfBonus=profBonus(skill.专精); }
    else if(skill.学习难度&&skill.学习难度!=='F'&&skill.学习难度!=='F-'){ skillProfBonus=profBonus(skill.学习难度); }
    if(hitExpr){ hit=nebDice(hitExpr+(skillProfBonus?('+'+skillProfBonus):''),p,'attack'); actionStr+='命中 '+hit.detail+'='+hit.total+(hit.crit?' [大成功]':'')+(hit.fumble?' [大失败]':'')+(skillProfBonus?' [技能专精]':'')+'\n'; }

    targets.forEach(function(def){
      if(hitExpr&&!isSelf){
        var dodge=nebDice('rd敏捷',def,'dodge');
        if(def._isMoving)dodge.total=Math.floor(dodge.total/2);
        var hitSuccess=isSummonSkill?true:(hit.total>dodge.total); /* A9: 召唤必中 */
        actionStr+=def.name+'闪避 '+dodge.detail+'='+dodge.total+(dodge.fumble?' [大失败]':'')+(isSummonSkill?' [召唤必中]':'')+'\n→ '+(hitSuccess?'命中':'未命中')+'\n';
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
            p.buffs.push({name:eff.name,effect:'attr_mod',target:eff.target||'',op:eff.op||'+',formula:eff.formula,flatVal:num(eff.formula,0),turns:eff.duration||3});
            actionStr+='获得'+eff.name+'('+eff.duration+'回合)\n';
          }
        }
        if(eff.effect==='attr_mod'){
          if(!p.buffs)p.buffs=[];
          p.buffs.push({name:skillName+':'+eff.target,effect:'attr_mod',target:eff.target,op:eff.op||'+',formula:eff.formula,flatVal:num(eff.formula,0),turns:eff.duration||3});
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
    var p=getControlledUnit(state); if(!p)return;
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
    var p=getControlledUnit(state); if(!p||p.ap<1){ addLog(state,'AP不足（反击需要1AP）'); if(typeof toastr!=='undefined')toastr.warning('AP不足（反击需要1AP）'); saveCombatState(state); return; }
    p.ap-=1; p.hp-=5; if(p.hp<0)p.hp=0;
    /* A9: 反击标记 - 放弃闪避，受击时反击 */
    p._isCountering=true;
    var action='玩家反击！放弃闪避，消耗1AP进行反击攻击\n（受击时结算反击伤害）\n消耗1AP/5HP(耐力) | AP->'+p.ap;
    var report=buildReport(state,action,rpText,'反击'); addLog(state,report);
    addActionToQueue(state,{type:'counter',report:action,rpText:rpText,undo:{apCost:1,staminaHp:5}});
  }
  function doDualWield(state, targetIdx, rpText){
    var p=getControlledUnit(state); if(!p||p.hp<=0)return; if(p.ap<4){ addLog(state,'双持攻击需要4AP'); if(typeof toastr!=='undefined')toastr.warning('双持攻击需要4AP，当前AP不足'); saveCombatState(state); return; }
    var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer&&u.hp>0;}); if(!def){ addLog(state,'无有效目标'); if(typeof toastr!=='undefined')toastr.warning('没有可攻击的目标'); saveCombatState(state); return; }
    var defIdx=state.units.indexOf(def);
    var hpBefore=def.hp;
    var mainHit=nebDice('r力量',p,'attack');
    var hitPen=rollDie(10); var dmgPen=rollDie(5);
    var offHitTotal=mainHit.total-hitPen;
    var dodge=nebDice('rd敏捷',def,'dodge');
    var action='玩家双持攻击 -> '+def.name+'\n主手命中 r力量='+mainHit.detail+'='+mainHit.total+'\n副手命中(主手-d10) '+mainHit.total+'-d10='+hitPen+'='+offHitTotal+'\n'+def.name+'闪避 rd敏捷='+dodge.detail+'='+dodge.total+'\n';
    var mainSuccess=mainHit.total>dodge.total, offSuccess=offHitTotal>dodge.total;
    action+='主手-> '+(mainSuccess?'命中':'未命中')+' | 副手-> '+(offSuccess?'命中':'未命中')+'\n';
    var totalDmg=0;
    if(mainSuccess){ var d1=nebDice('d4+DB',p,'damage'); totalDmg+=d1.total; action+='主手伤害 '+d1.detail+'='+d1.total+'\n'; }
    if(offSuccess){ var d2=nebDice('d4+DB',p,'damage'); var offDmg=Math.max(0,d2.total-dmgPen); totalDmg+=offDmg; action+='副手伤害 '+d2.detail+'='+d2.total+'-d5='+dmgPen+'='+offDmg+'\n'; }
    if(totalDmg>0){ def.hp-=totalDmg; if(def.hp<0)def.hp=0; action+=def.name+' HP '+def.hp+'\n'; }
    p.ap-=4; p.hp-=20; if(p.hp<0)p.hp=0;
    action+='消耗4AP/20HP(耐力) | AP->'+p.ap;
    var report=buildReport(state,action,rpText,'双持攻击'); addLog(state,report);
    addActionToQueue(state,{type:'dualwield',report:action,rpText:rpText,undo:{apCost:4,staminaHp:20,restores:[{idx:defIdx,hp:hpBefore-def.hp}]}});
  }
  function doThrow(state, targetIdx, rpText){
    var p=getControlledUnit(state); if(!p||p.hp<=0)return; if(p.ap<2){ addLog(state,'投掷需要2AP'); if(typeof toastr!=='undefined')toastr.warning('投掷需要2AP，当前AP不足'); saveCombatState(state); return; }
    var def=state.units[targetIdx]||state.units.find(function(u){return !u.isPlayer&&!u.isAlly&&u.hp>0;}); if(!def){ addLog(state,'无有效目标'); if(typeof toastr!=='undefined')toastr.warning('没有可投掷的目标'); saveCombatState(state); return; }
    var str=num(p.eff?p.eff['力量']:p.attrs['力量'],10);
    var dist=distance(p,def); if(dist>str){ addLog(state,'超出投掷距离！距离='+dist+'米，最大='+str+'米'); if(typeof toastr!=='undefined')toastr.warning('超出投掷距离（'+dist+'米 > 最大'+str+'米）'); saveCombatState(state); return; }
    var halfStr=Math.floor(str/2); if(halfStr<1)halfStr=1;
    /* A9: 投掷命中=d力量/2(取低)+投掷难易度+射击专精 */
    var profThrowBonus='';
    if(p.专精&&p.专精['射击']){ profThrowBonus=profBonus(p.专精['射击']); }
    var throwRoll=nebDice('d'+halfStr+(profThrowBonus?('+'+profThrowBonus):''),p,'attack');
    var dodge=nebDice('rd敏捷',def,'dodge');
    if(def._isMoving)dodge.total=Math.floor(dodge.total/2);
    var hitSuccess=throwRoll.total>dodge.total;
    var defIdx=state.units.indexOf(def);
    var hpBefore=def.hp;
    var action='玩家投掷攻击 -> '+def.name+' (距离'+dist+'米/最大'+str+'米)\n投掷命中 d'+halfStr+(profThrowBonus?('+'+profThrowBonus):'')+'='+throwRoll.total+(profThrowBonus?' [专精]':'')+'\n'+def.name+'闪避 rd敏捷='+dodge.detail+'='+dodge.total+'\n-> '+(hitSuccess?'命中':'未命中')+'\n';
    if(hitSuccess){ var dmg=nebDice('d4+DB',p,'damage'); var dmgDealt=Math.max(1,dmg.total-def.derived.physDef); def.hp-=dmgDealt; if(def.hp<0)def.hp=0; action+='伤害 '+dmg.detail+'='+dmg.total+' -> '+dmgDealt+'\n'+def.name+' HP '+def.hp; }
    p.ap-=2; p.hp-=10; if(p.hp<0)p.hp=0;
    action+='\n消耗2AP/10HP(耐力) | AP->'+p.ap;
    var report=buildReport(state,action,rpText,'投掷攻击'); addLog(state,report);
    addActionToQueue(state,{type:'throw',report:action,rpText:rpText,undo:{apCost:2,staminaHp:10,restores:[{idx:defIdx,hp:hpBefore-def.hp}]}});
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

  /* ===== 敌人生成解析（6属性，向后兼容4属性） ===== */
  function parseEnemySpawn(text){
    var results=[]; var m;
    /* 6属性：名称|HP|力量|敏捷|体质|智力|精神|魅力 */
    var regex6=/<enemy_spawn>\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^<]*?)\s*<\/enemy_spawn>/gi;
    while((m=regex6.exec(text))!==null){
      results.push({name:m[1].trim(),hp:parseInt(m[2].trim(),10)||30,str:parseInt(m[3].trim(),10)||12,agi:parseInt(m[4].trim(),10)||14,con:parseInt(m[5].trim(),10)||10,int:parseInt(m[6].trim(),10)||8,spi:parseInt(m[7].trim(),10)||8,cha:parseInt(m[8].trim(),10)||8});
    }
    /* 兼容4属性：名称|HP|力量|敏捷|体质（最后一字段不含|，避免与6属性重复匹配） */
    var regex4=/<enemy_spawn>\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|<]*?)\s*<\/enemy_spawn>/gi;
    while((m=regex4.exec(text))!==null){
      results.push({name:m[1].trim(),hp:parseInt(m[2].trim(),10)||30,str:parseInt(m[3].trim(),10)||12,agi:parseInt(m[4].trim(),10)||14,con:parseInt(m[5].trim(),10)||10,int:8,spi:8,cha:8});
    }
    /* Fallback: 2-field（最后一字段不含|，避免重复匹配） */
    var regex2=/<enemy_spawn>\s*([^|]+?)\s*\|\s*([^|<]+?)\s*<\/enemy_spawn>/gi;
    while((m=regex2.exec(text))!==null){
      results.push({name:m[1].trim(),hp:parseInt(m[2].trim(),10)||30,str:12,agi:14,con:10,int:8,spi:8,cha:8});
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
      var lidSr=lastMsgIdSafe();
      var msgs=lidSr!=null?getChatMessages('0-'+lidSr):null; if(!msgs||!msgs.length)return;
      var lastMsg=msgs[msgs.length-1]; var text=lastMsg.message||lastMsg.mes||'';
      var skills=parseSkillRegister(text); if(skills.length===0)return;
      var state=getCombatState();
      skills.forEach(function(sd){ var isNew=registerSkill(sd); if(state&&state.active){ addLog(state,(isNew?'★ 新技能注册':'技能更新')+': '+sd.name); } });
      if(state&&state.active){ saveCombatState(state); renderAllPanels(); }
    }catch(e){ console.error('[战斗引擎v6] 技能注册检查失败',e); }
  }
  /* 已处理过spawn的楼层ID（模块级存续，即使战斗状态被清空也能防止重复刷怪/战斗复活） */
  var handledSpawnMsgIds=[];
  function checkEnemySpawn(){
    try{
      var lidEs=lastMsgIdSafe();
      var msgs=lidEs!=null?getChatMessages('0-'+lidEs):null; if(!msgs||!msgs.length)return;
      var lastMsg=msgs[msgs.length-1]; var text=lastMsg.message||lastMsg.mes||'';
      var mid=(lastMsg&&lastMsg.message_id!=null)?lastMsg.message_id:null;
      var spawns=parseEnemySpawn(text); if(spawns.length===0)return;
      var state=getCombatState();
      /* 幂等防护：CHARACTER_MESSAGE_RENDERED/MESSAGE_UPDATED/GENERATION_ENDED 会对同一楼层重复触发，
         同一楼层消息的spawn只处理一次（否则同一批怪被当援军重复push -> 卡片重复） */
      var handledInState=!!(state&&state.spawnHandledMsgIds&&mid!=null&&state.spawnHandledMsgIds.indexOf(mid)>=0);
      if(mid!=null&&(handledSpawnMsgIds.indexOf(mid)>=0||handledInState)){ if(handledSpawnMsgIds.indexOf(mid)<0)handledSpawnMsgIds.push(mid); return; }
      if(mid!=null)handledSpawnMsgIds.push(mid);
      /* B2 自动启动桥：无活跃战斗且检测到<enemy_spawn> → 自动enterCombat */
      if(!state||!state.active){
        try{
          var enemies=spawns.map(function(s){return {name:s.name,hp:s.hp,str:s.str,agi:s.agi,con:s.con,int:s.int,spi:s.spi,cha:s.cha};});
          var allySpawns=parseAllySpawn(text);
          var allies=allySpawns.map(function(s){return {name:s.name,hp:s.hp,str:s.str,agi:s.agi,con:s.con,int:s.int,spi:s.spi,cha:s.cha};});
          if(typeof HOST.enterCombat==='function'){
            HOST.enterCombat({enemies:enemies,allies:allies},{injectCombatHud:true,posText:text,spawnMsgId:mid}).then(function(){
              /* 同步logic/script/terrain到生成的state */
              var st=getCombatState(); if(st){
                if(mid!=null){ if(!st.spawnHandledMsgIds)st.spawnHandledMsgIds=[]; if(st.spawnHandledMsgIds.indexOf(mid)<0)st.spawnHandledMsgIds.push(mid); }
                var logic=parseEnemyLogic(text); var script=parseScriptBlock(text,'enemy_script');
                st.units.forEach(function(u){ if(!u.isPlayer&&!u.isAlly){ if(logic)u.logic=logic; if(script)u.script=script; } });
                var terrain=parseTerrain(text); if(!st.terrain&&terrain)st.terrain=terrain;
                applyPositions(st,text);
                saveCombatState(st); renderAllPanels();
              }
              if(typeof toastr!=='undefined')toastr.success('检测到敌人，自动进入战斗！');
            });
          }
        }catch(e){ console.error('[战斗引擎v6] 自动启动战斗失败',e); }
        return;
      }
      /* 已在战斗中：作为援军加入（记录楼层ID，防止同一消息重复刷援军） */
      if(mid!=null){ if(!state.spawnHandledMsgIds)state.spawnHandledMsgIds=[]; if(state.spawnHandledMsgIds.indexOf(mid)<0)state.spawnHandledMsgIds.push(mid); }
      spawns.forEach(function(s){ var en=makeEnemy(s.name,s.hp,s.str,s.agi,s.con,s.int||8,s.spi||8,s.cha||8); calcDerived(en); state.units.push(en); addToRosterFromSpawn(s,'enemy',text); addLog(state,'★ 敌方援军加入: '+s.name+' HP'+s.hp); });
      applyPositions(state,text);
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
  var state_controlledId='player';

  function renderUnit(u, idx, idPrefix){
    calcDerived(u);
    var hpPct=u.derived.hpMax>0?(u.hp/u.derived.hpMax*100):0;
    var enPct=u.derived.energyMax>0?(u.energy/u.derived.energyMax*100):0;
    var cls=u.isPlayer?'player':(u.isAlly?'ally':'enemy');
    var tagTxt=u.isPlayer?'玩家':(u.isAlly?'队友':'敌人');
    var h='<div class="'+idPrefix+'-unit '+cls+'" data-u="'+idx+'">'+
      '<div class="'+idPrefix+'-unit-head"><span class="'+idPrefix+'-unit-name">'+esc(u.name)+'</span><span class="'+idPrefix+'-unit-tag">'+tagTxt+' ('+u.x+','+u.y+')</span></div>';
    /* A2: 操控对象切换（玩家/队友可切换操控） */
    if((u.isPlayer||u.isAlly)&&u.hp>0){
      var isControlled=state_controlledId===u.id;
      h+='<button class="'+idPrefix+'-ctrl-btn'+(isControlled?' active':'')+'" data-act="controlswitch" data-unit-id="'+esc(u.id)+'" style="font-size:9px;padding:2px 6px;margin-bottom:4px;'+(isControlled?'border-color:#48bb78;color:#48bb78;':'')+'">'+(isControlled?'● 操控中':'切换操控')+'</button>';
    }
    h+='<div class="'+idPrefix+'-bar-line"><span class="'+idPrefix+'-bar-label">HP</span>'+bar(hpPct,hpPct<30?'hp low':'hp',idPrefix)+'<span class="'+idPrefix+'-bar-val">'+u.hp+'/'+u.derived.hpMax+'</span></div>';
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
    if(state.controlledUnitId)state_controlledId=state.controlledUnitId;
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
    var tabs=[{id:'battlefield',label:'战场'},{id:'narrative',label:'正文'},{id:'terrain',label:'地形'},{id:'skills',label:'技能'},{id:'equipment',label:'装备'},{id:'items',label:'道具'},{id:'log',label:'日志'},{id:'archive',label:'战报存档'},{id:'roster',label:'角色管理'}];
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

    /* === 正文标签（整合：AI本轮回复 + 最新摘要 + 最新投点战报） === */
    if(state_activeTab==='narrative'){
      h+='<div class="'+idPrefix+'-page active" id="page-narrative">';
      var narr=state._narrativeText||'';
      if(narr){
        h+='<div class="'+idPrefix+'-narrative" style="background:rgba(255,255,255,0.55);border:1px solid rgba(255,255,255,0.7);border-radius:14px;padding:14px;margin-bottom:10px;line-height:1.8;font-size:13px;">'+esc(narr)+'</div>';
      } else { h+='<div class="'+idPrefix+'-empty">暂无AI演绎文本。战斗开始后，AI的演绎将显示在这里。</div>'; }
      /* 最新摘要 */
      var digs=state.digests||[];
      if(digs.length){
        var lastDig=digs[digs.length-1];
        h+='<details style="background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.3);border-radius:12px;padding:10px 14px;margin-bottom:10px;">';
        h+='<summary style="cursor:pointer;font-weight:600;color:#a78bfa;font-size:12px;list-style:none;">📋 本轮摘要·'+esc(lastDig.title||('回合'+lastDig.turn))+'</summary>';
        h+='<div style="margin-top:8px;font-size:11px;color:#463f63;line-height:1.7;white-space:pre-wrap;">'+esc(lastDig.text||'')+'</div>';
        h+='</details>';
      }
      /* 最新投点战报 */
      var logs=state.log||[];
      var recentLogs=logs.slice(-3).filter(function(e){return e.text;});
      if(recentLogs.length){
        h+='<div style="background:rgba(103,232,249,0.08);border:1px solid rgba(103,232,249,0.3);border-radius:12px;padding:10px 14px;">';
        h+='<div style="font-weight:600;color:#67e8f9;font-size:11px;margin-bottom:6px;">🎲 近期投点</div>';
        recentLogs.forEach(function(e){ h+='<div style="font-size:10px;color:#6b6488;font-family:monospace;white-space:pre-wrap;margin-bottom:4px;">'+esc(e.text.substring(0,200))+'</div>'; });
        h+='</div>';
      }
      h+='</div>';
    }

    /* === 地形标签 === */
    if(state_activeTab==='terrain'){
      h+='<div class="'+idPrefix+'-page active" id="page-terrain">';
      if(state.terrain){
        var t=state.terrain;
        h+='<div style="font-size:11px;color:#6b6488;margin-bottom:8px;">地图: '+t.width+'×'+t.height+' | 类型: 平地/高地(+命中)/墙壁(挡)/陷阱(触发)/掩体(减伤)/水域(cost高)/狭窄(-闪避)</div>';
        h+='<div style="display:inline-block;background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:10px;padding:8px;overflow:auto;max-width:100%;">';
        h+='<div style="display:grid;grid-template-columns:repeat('+t.width+',18px);gap:1px;font-family:monospace;font-size:9px;">';
        /* 顶部坐标 */
        for(var tx=0;tx<t.width;tx++){ h+='<div style="text-align:center;color:#9a8f70;height:14px;">'+(tx%5===0?tx:'·')+'</div>'; }
        for(var ty=0;ty<t.height;ty++){
          h+='<div style="text-align:center;color:#9a8f70;height:18px;line-height:18px;">'+(ty%2===0?ty:'·')+'</div>';
          for(var tx2=0;tx2<t.width;tx2++){
            var cell=t.cells[ty][tx2];
            var unitHere=state.units.find(function(u){return u.x===tx2&&u.y===ty&&u.hp>0;});
            var bg='#f3eefc', label='·';
            if(cell.type==='高地'){bg='#fef3c7';label='高';}
            else if(cell.type==='墙壁'){bg='#4a5568';label='#';}
            else if(cell.type==='陷阱'){bg='#fed7d7';label='×';}
            else if(cell.type==='掩体'){bg:'#c6f6d5';label='掩';}
            else if(cell.type==='水域'){bg='#bee3f8';label='水';}
            else if(cell.type==='狭窄'){bg='#e9d8fd';label='窄';}
            if(unitHere){ label=unitHere.isPlayer?'P':(unitHere.isAlly?'A':'E'); bg='#a78bfa'; }
            h+='<div style="width:18px;height:18px;background:'+bg+';display:flex;align-items:center;justify-content:center;border-radius:3px;color:'+(unitHere?'#fff':'#6b6488')+';font-weight:'+(unitHere?'700':'400')+';">'+label+'</div>';
          }
        }
        h+='</div>';
        h+='<div style="margin-top:8px;font-size:10px;color:#6b6488;"><span style="color:#a78bfa;">P</span>=玩家 <span style="color:#48bb78;">A</span>=队友 <span style="color:#e53e3e;">E</span>=敌方 | 高=高地 #=墙 ×=陷阱 掩=掩体 水=水域</div>';
        h+='</div>';
      } else {
        h+='<div class="'+idPrefix+'-empty">暂无地形数据。AI在战斗开始时输出<terrain>标签后，地形地图将显示在这里。</div>';
      }
      h+='</div>';
    }

    /* === 技能标签 === */
    if(state_activeTab==='skills'){      h+='<div class="'+idPrefix+'-page active" id="page-skills">';
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
      /* 极简花名册列表（Phase1可清错数据，完整编辑器留Phase2） */
      var roster=getCharacterRoster();
      if(roster&&roster.length){
        h+='<div class="'+idPrefix+'-section" style="margin-top:10px;"><div class="'+idPrefix+'-section-title">角色花名册 (chat变量)</div>';
        roster.forEach(function(r){
          h+='<div style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:6px 10px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">'+
            '<span style="font-size:11px;"><b style="color:'+(r.role==='ally'?'#48bb78':'#e53e3e')+';">'+esc(r.name)+'</b> <span style="color:#6b6488;font-size:10px;">'+(r.role==='ally'?'队友':'敌方')+(r.logic?' [有逻辑]':'')+(r.script?' [有脚本]':'')+'</span></span>'+
            '<button class="'+idPrefix+'-btn" data-act="rosterdel" data-name="'+esc(r.name)+'" style="font-size:10px;padding:2px 8px;color:#e53e3e;">删除</button></div>';
        });
        h+='</div>';
      }
      h+='</div>';
    }

    /* === 战报存档标签 === */
    if(state_activeTab==='archive'){
      h+='<div class="'+idPrefix+'-page active" id="page-archive">';
      var digs=state.digests||[];
      if(digs.length){
        digs.forEach(function(dg,i){
          h+='<details class="'+idPrefix+'-archive-item" style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:10px;padding:8px 12px;margin-bottom:8px;">';
          h+='<summary style="cursor:pointer;font-weight:600;color:#a78bfa;font-size:12px;list-style:none;">回合'+dg.turn+' · '+esc(dg.title||'战报')+'</summary>';
          h+='<div style="margin-top:6px;font-size:11px;color:#463f63;line-height:1.7;white-space:pre-wrap;">'+esc(dg.text||'')+'</div>';
          h+='</details>';
        });
      } else { h+='<div class="'+idPrefix+'-empty">暂无战报存档。AI每回合生成的digest摘要会显示在这里。</div>'; }
      h+='</div>';
    }

    /* === 角色管理标签 === */
    if(state_activeTab==='roster'){
      h+='<div class="'+idPrefix+'-page active" id="page-roster">';
      var roster=getCharacterRoster();
      if(roster&&roster.length){
        h+='<div style="font-size:11px;color:#6b6488;margin-bottom:8px;">角色花名册（chat变量存储）。点击角色展开编辑logic/stats/lore。保存后下回合生效。</div>';
        roster.forEach(function(r,ri){
          var roleColor=r.role==='ally'?'#48bb78':(r.role==='enemy'?'#e53e3e':'#a78bfa');
          h+='<details style="background:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.7);border-radius:12px;padding:10px 14px;margin-bottom:8px;">';
          h+='<summary style="cursor:pointer;font-weight:600;color:'+roleColor+';font-size:13px;list-style:none;">'+esc(r.name)+' <span style="font-size:10px;color:#6b6488;font-weight:400;">'+(r.role==='ally'?'队友':'敌方')+(r.logic?' [有逻辑]':'')+(r.script?' [有脚本]':'')+'</span></summary>';
          h+='<div style="margin-top:10px;">';
          /* 属性 */
          if(r.stats){
            h+='<div style="font-size:10px;color:#6b6488;margin-bottom:4px;">属性: HP'+r.stats.hp+' 力'+r.stats.str+' 敏'+r.stats.agi+' 体'+r.stats.con+' 智'+r.stats.int+' 精'+r.stats.spi+' 魅'+r.stats.cha+'</div>';
          }
          /* lore编辑 */
          h+='<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;display:block;">Lore（写入聊天世界书）</label>';
          h+='<textarea id="roster-lore-'+ri+'" style="width:100%;min-height:50px;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:6px 10px;font-size:11px;color:#463f63;font-family:inherit;resize:vertical;box-sizing:border-box;">'+esc(r.lore||'')+'</textarea></div>';
          /* logic JSON编辑器 */
          h+='<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;display:block;">Logic JSON（声明式逻辑表）</label>';
          var logicStr=r.logic?JSON.stringify(r.logic,null,2):'';
          h+='<textarea id="roster-logic-'+ri+'" class="roster-logic-editor" style="width:100%;min-height:100px;background:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.7);border-radius:8px;padding:6px 10px;font-size:10px;color:#463f63;font-family:monospace;resize:vertical;box-sizing:border-box;" placeholder=\'{"性格":"激进","行动优先级":[{"默认":true,"行动":"攻击"}]}\'>'+esc(logicStr)+'</textarea>';
          h+='<div id="roster-logic-err-'+ri+'" style="font-size:10px;color:#e53e3e;display:none;"></div></div>';
          /* actionScript编辑器 */
          h+='<div style="margin-bottom:8px;"><label style="font-size:10px;color:#6b6488;display:block;">ActionScript（可选例外代码，⚠危险模式）</label>';
          h+='<textarea id="roster-script-'+ri+'" style="width:100%;min-height:60px;background:rgba(255,235,235,0.5);border:1px solid rgba(229,62,62,0.3);border-radius:8px;padding:6px 10px;font-size:10px;color:#463f63;font-family:monospace;resize:vertical;box-sizing:border-box;" placeholder="(me,e,a,s,h)=>{ return {action:\"攻击\"}; }">'+esc(r.script||'')+'</textarea></div>';
          /* 保存/删除按钮 */
          h+='<div style="display:flex;gap:6px;">';
          h+='<button class="'+idPrefix+'-btn '+idPrefix+'-btn-primary" data-act="rostersave" data-name="'+esc(r.name)+'" data-idx="'+ri+'" style="font-size:11px;">💾 保存</button>';
          h+='<button class="'+idPrefix+'-btn" data-act="rosterdel" data-name="'+esc(r.name)+'" style="font-size:11px;color:#e53e3e;">🗑 删除</button>';
          h+='</div>';
          h+='</div>';
          h+='</details>';
        });
      } else { h+='<div class="'+idPrefix+'-empty">暂无角色花名册。AI生成敌方/队友后会自动入册。</div>'; }
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
      state={turn:1,units:[],log:[],phase:'PLAYER_ACTING',active:true,targetIdx:1,combatMessageId:null,pendingActions:[],narratives:[],digests:[],terrain:null,controlledUnitId:'player'};
      if(d){ var p=seedPlayer(d); calcDerived(p); state.units.push(p); } else { var p2=makeEnemy('玩家',40,12,12,12,12,12,12); p2.isPlayer=true; p2.id='player'; calcDerived(p2); state.units.push(p2); }
      var enName='哥布林',enHp=30,enStr=12,enAgi=14,enCon=10;
      try{ enName=mount.querySelector('#cb-en-name').value||'哥布林'; enHp=parseInt(mount.querySelector('#cb-en-hp').value||'30',10); enStr=mount.querySelector('#cb-en-str').value; enAgi=mount.querySelector('#cb-en-agi').value; enCon=mount.querySelector('#cb-en-con').value; }catch(e){}
      var enemy=makeEnemy(enName,enHp,enStr,enAgi,enCon,8,8,8); calcDerived(enemy); state.units.push(enemy);
      addLog(state,'-- 战斗开始 · 回合1 --');
      var initReport=buildReport(state,'战斗开始！'+state.units.map(function(u){return u.name+' HP'+u.hp+'/'+u.derived.hpMax;}).join(' vs '),'','战斗开始');
      addLog(state,initReport);
      /* 不注入新楼层 */
      saveCombatState(state);
      renderAllPanels(); return;
    }
    if(act==='endcombat'){ addLog(state,'-- 战斗结束（手动） --'); finalizeCombatMessage(state,'战斗结束（手动）'); return; }
    if(act==='endturn'){ if(!state.active)return; endTurn(state); return; }
    if(act==='removepending'){ if(state.pendingActions){ var pi=parseInt(data.pidx,10); var pa=state.pendingActions[pi]; state.pendingActions.splice(pi,1); undoPendingAction(state,pa); requeueMarks(state); addLog(state,'已移除并回滚队列行动'+(pa&&pa.type?('·'+pa.type):'')); saveCombatState(state); renderAllPanels(); } return; }
    if(!state.active)return;
    if(state.phase==='AI_GENERATING'||state.phase==='ENEMY_RESOLVING')return;
    if(state.phase!=='PLAYER_ACTING')return;
    var rpText=''; try{ var rpInput=mount.querySelector('#cb-rp-input'); if(rpInput)rpText=rpInput.value.trim(); }catch(e){}
    if(act==='attack'){ doPlayerAttack(state,state.targetIdx||1,false,0,rpText); renderAllPanels(); return; }
    if(act==='aoe'){ doPlayerAttack(state,state.targetIdx||1,true,null,rpText); renderAllPanels(); return; }
    if(act==='dodge'){ doDodge(state,rpText); renderAllPanels(); return; }
    if(act==='parry'){ doParry(state,data.pt||'weapon',rpText); renderAllPanels(); return; }
    if(act==='move'){ doMove(state,data.mode||'walk',rpText); renderAllPanels(); return; }
    if(act==='freeroll'){ var input=mount.querySelector('#cb-dice-expr'); doFreeRoll(state,input?input.value:'d20',rpText); renderAllPanels(); return; }
    if(act==='customaction'){ if(!rpText){ addLog(state,'请在RP输入框描述你的行动'); if(typeof toastr!=='undefined')toastr.warning('请先在RP输入框描述你的行动'); return; } openRollTypeModal(state,rpText); return; }
    if(act==='atktype'){ var p=getControlledUnit(state); if(p){ p.atkType=(p.atkType==='magic'?'phys':'magic'); saveCombatState(state); renderAllPanels(); } return; }
    if(act==='wtype'){ var pw=getControlledUnit(state); if(pw){ pw.weaponType=(pw.weaponType==='twohand'?'onehand':'twohand'); saveCombatState(state); renderAllPanels(); } return; }
    if(act==='addenemy'){ openAddEnemyModal(state); return; }
    if(act==='addbuff'){ openBuffModal(state); return; }
    if(act==='counter'){ doCounter(state,state.targetIdx||1,rpText); renderAllPanels(); return; }

    if(act==='throw'){ doThrow(state,state.targetIdx||1,rpText); renderAllPanels(); return; }
    if(act==='skilledit'){ openSkillEditor(); return; }
    if(act==='useitem'){ doUseConsumable(state,data.itemName||data.name||'',rpText); renderAllPanels(); return; }
    if(act==='rosterdel'){ var rname=data.name||data.rosterName||''; if(rname){ removeFromRoster(rname); removeRosterWorldInfo(rname); addLog(state,'已从花名册删除: '+rname); renderAllPanels(); } return; }
    if(act==='rostersave'){
      var ri=parseInt(data.idx,10); var roster=getCharacterRoster(); var entry=roster[ri];
      if(entry){
        var errEl=mount.querySelector('#roster-logic-err-'+ri);
        var loreEl=mount.querySelector('#roster-lore-'+ri);
        var logicEl=mount.querySelector('#roster-logic-'+ri);
        var scriptEl=mount.querySelector('#roster-script-'+ri);
        var patch={};
        if(loreEl)patch.lore=loreEl.value;
        if(scriptEl)patch.script=scriptEl.value.trim()||null;
        if(logicEl){
          var logicStr=logicEl.value.trim();
          if(logicStr){
            try{ patch.logic=JSON.parse(logicStr); if(errEl){errEl.style.display='none';} }
            catch(e){ if(errEl){errEl.textContent='JSON解析失败: '+e.message;errEl.style.display='block';} addLog(state,'logic JSON校验失败: '+e.message); return; }
          } else { patch.logic=null; }
        }
        updateRosterEntry(data.name, patch);
        /* 同步lore到世界书 */
        if(patch.lore!==undefined){ syncRosterToWorldInfo(Object.assign({},entry,patch)); }
        /* 同步logic到当前战斗中的单位 */
        var unit=state.units.find(function(u){return u.name===data.name;});
        if(unit){ if(patch.logic!==undefined)unit.logic=patch.logic; if(patch.script!==undefined)unit.script=patch.script; saveCombatState(state); }
        addLog(state,'已保存角色: '+data.name);
      }
      renderAllPanels(); return;
    }
    if(act==='controlswitch'){ var cu=state.units.find(function(u){return u.id===data.unitId;}); if(cu&&(cu.isPlayer||cu.isAlly)){ state.controlledUnitId=cu.id; state_controlledId=cu.id; state_targetIdx=state.units.indexOf(cu); saveCombatState(state); renderAllPanels(); } return; }
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

  /* ======================================================================
   * 队友支持 (Ally Support) — A2
   * ====================================================================== */
  function makeAlly(name,hp,str,agi,con,int,spi,cha){
    return {id:'a'+Date.now(),name:name||'队友',isPlayer:false,isAlly:true,
      attrs:{'力量':str||10,'敏捷':agi||10,'体质':con||10,'智力':int||10,'精神':spi||10,'魅力':cha||10},
      hpMaxBase:hp||30,hp:hp||30,energy:0,energyType:'能量',ap:4,buffs:[],cooldowns:{},pendingActions:[],
      equipBonus:{physDef:0,mystDef:0,crit:0,energy:0},equippedSlots:{},
      atkType:'phys',weaponType:'onehand',x:3,y:4,专精:{}};
  }
  function parseAllySpawn(text){
    var results=[]; var m;
    /* 6属性：名称|HP|力量|敏捷|体质|智力|精神|魅力（8字段） */
    var regex=/<ally_spawn>\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|<]*?)\s*<\/ally_spawn>/gi;
    while((m=regex.exec(text))!==null){ results.push({name:m[1].trim(),hp:parseInt(m[2].trim(),10)||30,str:parseInt(m[3].trim(),10)||12,agi:parseInt(m[4].trim(),10)||14,con:parseInt(m[5].trim(),10)||10,int:parseInt(m[6].trim(),10)||8,spi:parseInt(m[7].trim(),10)||8,cha:parseInt(m[8].trim(),10)||8}); }
    /* 兼容4属性（最后一字段不含|，避免与6属性重复匹配） */
    var regex4=/<ally_spawn>\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|<]*?)\s*<\/ally_spawn>/gi;
    while((m=regex4.exec(text))!==null){ results.push({name:m[1].trim(),hp:parseInt(m[2].trim(),10)||30,str:parseInt(m[3].trim(),10)||12,agi:parseInt(m[4].trim(),10)||14,con:parseInt(m[5].trim(),10)||10,int:8,spi:8,cha:8}); }
    return results;
  }
  function parseAllyAction(text){
    var results=[]; var m;
    var regex=/<ally_action>\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^<]*?)\s*<\/ally_action>/gi;
    while((m=regex.exec(text))!==null){ results.push({actor:m[1].trim(),action:m[2].trim(),target:m[3].trim(),param:m[4].trim()}); }
    var regex2=/<ally_action>\s*([^|]+?)\s*\|\s*([^|<]+?)\s*<\/ally_action>/gi;
    while((m=regex2.exec(text))!==null){ results.push({actor:m[1].trim(),action:m[2].trim(),target:'',param:''}); }
    return results;
  }
  function resolveAllyAction(state, aa){
    var actor=state.units.find(function(u){return u.name===aa.actor||u.id===aa.actor;});
    if(!actor||actor.hp<=0||!actor.isAlly)return aa.actor+'无法行动';
    var enemySide=state.units.filter(function(u){return !u.isPlayer&&!u.isAlly&&u.hp>0;});
    var target=enemySide.find(function(u){return u.name===aa.target||u.id===aa.target;});
    if(!target)target=selectTarget(state,actor,{偏好:'距离最近'})||enemySide[0];
    if(aa.action==='攻击'||aa.action==='技能'){
      var r=resolveAttack(actor,target,state,{});
      var apCost=(actor.weaponType==='twohand')?3:2; costAP(actor,apCost);
      addLog(state,r.summary); return r.summary;
    }
    if(aa.action==='闪避'){ markDodge(actor); addLog(state,actor.name+'闪避(待结算)'); return actor.name+'闪避'; }
    if(aa.action==='移动'){ var coords=String(aa.param).split(','); if(coords.length>=2){ actor.x=parseInt(coords[0],10)||actor.x; actor.y=parseInt(coords[1],10)||actor.y; } costAP(actor,1); addLog(state,actor.name+'移动到('+actor.x+','+actor.y+')'); return actor.name+'移动'; }
    if(aa.action==='防御'||aa.action==='等待'){ addLog(state,actor.name+'防御'); return actor.name+'防御'; }
    return actor.name+'执行:'+aa.action;
  }

  /* ======================================================================
   * Digest 解析 — A1
   * ====================================================================== */
  function parseDigest(text){
    var m=String(text||'').match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    if(!m)return null;
    return {title:null, text:m[1].trim()};
  }

  /* ======================================================================
   * 声明式逻辑表 + actionScript安全管线 — A5
   * ====================================================================== */
  function parseLogicBlock(text, tag){
    var m=String(text||'').match(new RegExp('<'+tag+'>\\s*([\\s\\S]*?)\\s*</'+tag+'>','i'));
    if(!m)return null;
    var raw=m[1].trim();
    try{ return JSON.parse(raw); }catch(e){ console.warn('[战斗引擎v6] '+tag+' JSON解析失败',e); return null; }
  }
  function parseScriptBlock(text, tag){
    var m=String(text||'').match(new RegExp('<'+tag+'>\\s*([\\s\\S]*?)\\s*</'+tag+'>','i'));
    if(!m)return null;
    return m[1].trim();
  }
  function parseEnemyLogic(text){ return parseLogicBlock(text,'enemy_logic'); }
  function parseAllyLogic(text){ return parseLogicBlock(text,'ally_logic'); }

  /* 条件DSL求值：纯字符串匹配+数值比较，永不eval。支持"且"/"或"复合。 */
  function evaluateCondition(state, unit, cond){
    if(!cond||cond===true)return true;
    cond=String(cond).trim(); if(!cond)return true;
    /* 复合：含"且"或"或" */
    if(cond.indexOf('且')>=0||cond.indexOf('或')>=0){
      var parts, op;
      if(cond.indexOf('且')>=0){ parts=cond.split('且'); op='and'; } else { parts=cond.split('或'); op='or'; }
      for(var i=0;i<parts.length;i++){ var r=evaluateCondition(state,unit,parts[i].trim()); if(op==='and'&&!r)return false; if(op==='or'&&r)return true; }
      return op==='and';
    }
    var eff=unit.eff||unit.attrs||{};
    var hpPct=unit.derived&&unit.derived.hpMax>0?(unit.hp/unit.derived.hpMax*100):100;
    var ap=num(unit.ap,0);
    var energy=num(unit.energy,0);
    var turn=state.turn||1;
    /* 自身HP<X% */
    var m=cond.match(/^自身HP<(\d+)%$/); if(m)return hpPct<parseFloat(m[1]);
    m=cond.match(/^自身HP>(\d+)%$/); if(m)return hpPct>parseFloat(m[1]);
    /* 友方HP<X% */
    m=cond.match(/^友方HP<(\d+)%$/);
    if(m){ var allies=state.units.filter(function(u){return (u.isPlayer||u.isAlly)&&u!==unit&&u.hp>0;}); if(!allies.length)return false; return allies.some(function(u){ var p=u.derived&&u.derived.hpMax>0?(u.hp/u.derived.hpMax*100):100; return p<parseFloat(m[1]); }); }
    /* 敌方存活数>N */
    m=cond.match(/^敌方存活数>(\d+)$/); if(m){ var alive=state.units.filter(function(u){return !u.isPlayer&&!u.isAlly&&u.hp>0;}).length; return alive>parseInt(m[1],10); }
    m=cond.match(/^敌方存活数<(\d+)$/); if(m){ var alive2=state.units.filter(function(u){return !u.isPlayer&&!u.isAlly&&u.hp>0;}).length; return alive2<parseInt(m[1],10); }
    /* 回合>=N */
    m=cond.match(/^回合>=(\d+)$/); if(m)return turn>=parseInt(m[1],10);
    /* 自身AP>=N */
    m=cond.match(/^自身AP>=(\d+)$/); if(m)return ap>=parseInt(m[1],10);
    /* 自身能量>=N */
    m=cond.match(/^自身能量>=(\d+)$/); if(m)return energy>=parseInt(m[1],10);
    /* 主目标距离>N / <=N */
    m=cond.match(/^主目标距离>(\d+)$/); if(m){ var tgt=getMainTarget(state,unit); if(!tgt)return false; return distance(unit,tgt)>parseInt(m[1],10); }
    m=cond.match(/^主目标距离<=(\d+)$/); if(m){ var tgt2=getMainTarget(state,unit); if(!tgt2)return false; return distance(unit,tgt2)<=parseInt(m[1],10); }
    /* 有buff:XX / 无buff:XX */
    m=cond.match(/^有buff:(.+)$/); if(m){ var nm=m[1].trim(); return (unit.buffs||[]).some(function(b){return b.name===nm;}); }
    m=cond.match(/^无buff:(.+)$/); if(m){ var nm2=m[1].trim(); return !(unit.buffs||[]).some(function(b){return b.name===nm2;}); }
    /* 专精>=XX */
    m=cond.match(/^专精>=(.+)$/); if(m){ var sp=m[1].trim(); return !!(unit.专精&&unit.专精[sp]); }
    /* 地形相关（A6） */
    if(cond.indexOf('高地')>=0||cond.indexOf('水域')>=0||cond.indexOf('陷阱')>=0||cond.indexOf('靠墙')>=0){ return checkTerrainCondition(state,unit,cond); }
    /* 无效条件忽略 */
    return false;
  }
  function getMainTarget(state, unit){
    var enemySide=state.units.filter(function(u){return (unit.isPlayer||unit.isAlly)?(!u.isPlayer&&!u.isAlly):(u.isPlayer||u.isAlly);});
    return enemySide.find(function(u){return u.hp>0;})||enemySide[0];
  }
  function selectTarget(state, unit, prefs){
    var enemySide=state.units.filter(function(u){return (unit.isPlayer||unit.isAlly)?(!u.isPlayer&&!u.isAlly&&u.hp>0):(u.isPlayer||u.isAlly)&&u.hp>0;});
    if(!enemySide.length)return null;
    var pref=prefs&&prefs.偏好?prefs.偏好: (prefs&&prefs.target)||'';
    if(pref==='HP最低'||pref==='受伤友方'){ return enemySide.reduce(function(a,b){return (a.hp<b.hp)?a:b;}); }
    if(pref==='距离最近'){ return enemySide.reduce(function(a,b){return (distance(unit,a)<distance(unit,b))?a:b;}); }
    if(pref==='玩家优先'){ var p=enemySide.find(function(u){return u.isPlayer;}); if(p)return p; }
    if(pref==='脆皮优先'){ return enemySide.reduce(function(a,b){return (a.derived&&a.derived.hpMax<b.derived.hpMax)?a:b;}); }
    if(pref==='仇恨最高'&&unit.仇恨){ var h=enemySide.filter(function(u){return unit.仇恨[u.name]>0;}); if(h.length)return h.reduce(function(a,b){return (unit.仇恨[a.name]>unit.仇恨[b.name])?a:b;}); }
    return enemySide[0];
  }
  /* decideUnitAction：有script走安全管线，否则遍历logic.行动优先级 */
  function decideUnitAction(state, unit){
    if(!unit)return null;
    /* 逃跑条件 */
    if(unit.logic&&unit.logic.逃跑条件&&evaluateCondition(state,unit,unit.logic.逃跑条件)){
      return {action:'逃跑', target:null, params:{}};
    }
    /* 例外代码 */
    if(unit.script){
      var r=safeRunScript(unit.script, unit, state);
      if(r&&r.action)return r;
      console.warn('[战斗引擎v6] actionScript降级到JSON逻辑表: '+unit.name);
    }
    /* 声明式逻辑表 */
    if(unit.logic&&Array.isArray(unit.logic.行动优先级)){
      for(var i=0;i<unit.logic.行动优先级.length;i++){
        var rule=unit.logic.行动优先级[i];
        if(rule.默认===true||evaluateCondition(state,unit,rule.条件)){
          var params=rule.参数||{};
          var target=null;
          var pref=unit.logic.目标选择||params.目标||'';
          if(rule.行动==='攻击'||rule.行动==='技能'||rule.行动==='投掷'){
            target=selectTarget(state,unit,{偏好:pref})||(params.目标?null:null);
          }
          return {action:rule.行动, target:target, params:params, skill:params.技能||null};
        }
      }
    }
    /* 默认：攻击主目标 */
    var tgt=getMainTarget(state,unit);
    return {action:'攻击', target:tgt, params:{}};
  }
  /* actionScript安全管线 */
  function safeRunScript(body, unit, state){
    if(!body||typeof body!=='string')return null;
    /* 静态危险检查 */
    if(/while\s*\(\s*(true|1)\s*\)/i.test(body)||/for\s*\(\s*;\s*;\s*\)/i.test(body)||/while\s*\(\s*1\s*\)/i.test(body)){
      console.warn('[战斗引擎v6] actionScript含危险循环模式，拒绝编译'); return null;
    }
    var enemies=state.units.filter(function(u){return (!u.isPlayer&&!u.isAlly)?(u.isPlayer||u.isAlly):(!u.isPlayer&&!u.isAlly);}).filter(function(u){return u.hp>0;});
    var allies=state.units.filter(function(u){return (u.isPlayer||u.isAlly)?(u.isPlayer||u.isAlly):(!u.isPlayer&&!u.isAlly);}).filter(function(u){return u!==unit&&u.hp>0;});
    var helpers={
      dice:function(expr){ return nebDice(expr,unit,'custom'); },
      dist:function(a,b){ return distance(a,b); },
      lowestHP:function(arr){ if(!arr||!arr.length)return null; return arr.reduce(function(x,y){return (x.hp<y.hp)?x:y;}); },
      nearest:function(arr){ if(!arr||!arr.length)return null; return arr.reduce(function(x,y){return (distance(unit,x)<distance(unit,y))?x:y;}); },
      hasBuff:function(u,nm){ return (u.buffs||[]).some(function(b){return b.name===nm;}); },
      countAlive:function(arr){ return (arr||[]).filter(function(u){return u.hp>0;}).length; },
      inLineOfSight:function(){ return true; },
      terrainAt:function(){ return null; }
    };
    try{
      var fn=new Function('me','enemies','allies','state','helpers', body);
      var result=fn(unit,enemies,allies,state,helpers);
      if(result&&typeof result==='object')return result;
      return null;
    }catch(e){ console.warn('[战斗引擎v6] actionScript执行失败，降级: '+unit.name, e); return null; }
  }

  /* ======================================================================
   * 角色花名册 (Character Roster, chat变量) — A7
   * ====================================================================== */
  function getCharacterRoster(){
    try{ if(typeof getVariables==='function'){ var v=getVariables({type:'chat'}); if(v&&v.character_roster)return v.character_roster; } }catch(e){}
    return [];
  }
  function saveCharacterRoster(roster){
    try{ if(typeof insertOrAssignVariables==='function'){ insertOrAssignVariables({character_roster:roster||[]},{type:'chat'}); } }catch(e){ console.error('[战斗引擎v6] 保存花名册失败',e); }
  }
  function findRosterEntry(roster, name){
    for(var i=0;i<roster.length;i++){ if(roster[i]&&roster[i].name===name)return roster[i]; }
    return null;
  }
  function addToRoster(entry){
    if(!entry||!entry.name)return;
    var roster=getCharacterRoster();
    var exist=findRosterEntry(roster,entry.name);
    if(exist){ Object.keys(entry).forEach(function(k){ exist[k]=entry[k]; }); }
    else { roster.push(entry); }
    saveCharacterRoster(roster);
  }
  function updateRosterEntry(name, patch){
    var roster=getCharacterRoster(); var e=findRosterEntry(roster,name);
    if(e){ Object.keys(patch||{}).forEach(function(k){ e[k]=patch[k]; }); saveCharacterRoster(roster); }
  }
  function removeFromRoster(name){
    var roster=getCharacterRoster();
    roster=roster.filter(function(r){return r.name!==name;});
    saveCharacterRoster(roster);
  }
  /* 从spawn解析结果构建roster条目（含skills/equipment/logic/script，从AI回复原文提取） */
  function addToRosterFromSpawn(s, role, replyText){
    var entry={name:s.name, role:role, stats:{hp:s.hp,str:s.str,agi:s.agi,con:s.con,int:s.int||8,spi:s.spi||8,cha:s.cha||8},
      skills:null, equipment:null, logic:null, script:null, lore:'', source:'ai', editable:true, updatedAt:Date.now()};
    if(replyText){
      var logic=role==='ally'?parseAllyLogic(replyText):parseEnemyLogic(replyText);
      if(logic)entry.logic=logic;
      var script=role==='ally'?parseScriptBlock(replyText,'ally_script'):parseScriptBlock(replyText,'enemy_script');
      if(script)entry.script=script;
    }
    addToRoster(entry);
  }
  /* callAI snapshot 兜底：参战角色lore注入 */
  function buildRosterLoreSnippet(state){
    if(!state||!state.units)return '';
    var roster=getCharacterRoster();
    var lines=[];
    state.units.forEach(function(u){
      if(u.isPlayer)return;
      var e=findRosterEntry(roster,u.name);
      if(e&&e.lore){ lines.push(u.name+': '+String(e.lore).substring(0,120)); }
    });
    return lines.length?('【角色档案】\n'+lines.join('\n')):'';
  }

  /* ======================================================================
   * 世界书 lore 同步 (聊天世界书) — A8
   * ====================================================================== */
  var _chatWorldbookName=null;
  function getChatWbName(){
    if(_chatWorldbookName)return _chatWorldbookName;
    try{ if(typeof getOrCreateChatWorldbook==='function'){ /* async, 但同步检查已有 */ } }catch(e){}
    try{ if(typeof getChatWorldbookName==='function'){ _chatWorldbookName=getChatWorldbookName('current'); } }catch(e){}
    return _chatWorldbookName;
  }
  async function syncRosterToWorldInfo(entry){
    if(!entry||!entry.name)return;
    try{
      var wbName=_chatWorldbookName;
      if(!wbName&&typeof getOrCreateChatWorldbook==='function'){ wbName=await getOrCreateChatWorldbook('current'); _chatWorldbookName=wbName; }
      if(!wbName||typeof createWorldbookEntries!=='function'||typeof deleteWorldbookEntries!=='function')return;
      /* 先删同名旧条目 */
      try{ await deleteWorldbookEntries(wbName, function(e){ return e&&e.name===entry.name; }); }catch(e){}
      /* 再建新条目 */
      await createWorldbookEntries(wbName, [{
        name:entry.name, enabled:true,
        strategy:{type:'selective', keys:[entry.name], keys_secondary:{logic:'and_any', keys:[]}, scan_depth:'same_as_global'},
        position:{type:'at_depth', role:'system', depth:4, order:500},
        content: entry.lore||('【'+entry.name+'】暂无档案。'),
        probability:100,
        recursion:{prevent_incoming:false, prevent_outgoing:false, delay_until:null},
        effect:{sticky:null, cooldown:null, delay:null}
      }]);
    }catch(e){ console.warn('[战斗引擎v6] 世界书lore同步失败(降级snapshot兜底): '+entry.name, e); }
  }
  async function removeRosterWorldInfo(name){
    try{
      var wbName=_chatWorldbookName||getChatWbName();
      if(!wbName||typeof deleteWorldbookEntries!=='function')return;
      await deleteWorldbookEntries(wbName, function(e){ return e&&e.name===name; });
    }catch(e){}
  }

  /* ======================================================================
   * parry/dodge/counter 效果标记 (A9 修复：让效果真正挂到resolveAttack)
   * ====================================================================== */
  function markDodge(unit){ unit._dodgeRoll=unit._dodgeRoll||null; unit._isDodging=true; }
  function markParry(unit, ptype){
    var base=Math.floor((num(unit.eff['力量'],10)+num(unit.eff['敏捷'],10))/2);
    var r=rollDie(base);
    var threshold={weapon:5,shield2h:5,shield1h:8,barehand:8}[ptype]||5;
    var reduceRate={weapon:0,shield2h:0.4,shield1h:0.2,barehand:0.2}[ptype]||0;
    unit._parryState={roll:r, base:base, threshold:threshold, reduceRate:reduceRate, ptype:ptype, crit:(r===base&&base>1), fumble:(r===1&&base>1)};
  }
  function consumeDodge(unit){ if(!unit||!unit._isDodging)return null; var r=nebDice('rd敏捷',unit,'dodge'); unit._isDodging=false; return r; }
  function consumeParry(unit){ if(!unit||!unit._parryState)return null; var p=unit._parryState; unit._parryState=null; return p; }

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

  /* ===== 同层前端适配: enterCombat + CombatV6 命名空间 (真同层改造) ===== */
  async function enterCombat(spawns, opts){
    opts=opts||{};
    var d=fetchStatData();
    var state={turn:1,units:[],log:[],phase:'PLAYER_ACTING',active:true,targetIdx:1,combatMessageId:null,pendingActions:[],narratives:[],digests:[],terrain:null,controlledUnitId:'player'};
    if(d){ var p=seedPlayer(d); calcDerived(p); state.units.push(p); }
    else{ var p2=makeEnemy('玩家',40,12,12,12,12,12,12); p2.isPlayer=true; p2.id='player'; calcDerived(p2); state.units.push(p2); }
    /* 兼容两种spawns格式：[{name,hp,str...}] 或 {enemies:[...],allies:[...]} */
    var enemyArr=[], allyArr=[];
    if(Array.isArray(spawns)){ enemyArr=spawns; }
    else if(spawns&&typeof spawns==='object'){ enemyArr=Array.isArray(spawns.enemies)?spawns.enemies:[]; allyArr=Array.isArray(spawns.allies)?spawns.allies:[]; }
    /* [地形可视化修复] 地形提前赋值，便于下方默认站位按战场尺寸散开并防越界 */
    if(opts.terrain)state.terrain=opts.terrain;
    var tw=state.terrain?state.terrain.width:12, th=state.terrain?state.terrain.height:8;
    enemyArr.forEach(function(s,ei){
      var en=makeEnemy(s.name||'敌人', s.hp||30, s.str||12, s.agi||14, s.con||10, s.int||8, s.spi||8, s.cha||8);
      if(s.专精)en.专精=s.专精; if(s.logic)en.logic=s.logic; if(s.script)en.script=s.script;
      /* [地形可视化修复] 敌人默认站位散开（列7-9，行2/4/6），避免全部叠在同一格 */
      en.x=Math.min(tw-1, 7+(ei%3));
      en.y=Math.min(th-1, 2+Math.floor(ei/3)*2);
      calcDerived(en); state.units.push(en);
    });
    allyArr.forEach(function(s,ai){
      var al=makeAlly(s.name||'队友', s.hp||30, s.str||12, s.agi||14, s.con||10, s.int||8, s.spi||8, s.cha||8);
      if(s.专精)al.专精=s.专精; if(s.logic)al.logic=s.logic; if(s.script)al.script=s.script;
      /* [地形可视化修复] 队友默认站位散开（列3-4，行2/4/6），围绕玩家布置 */
      al.x=Math.max(1, Math.min(tw-1, 3+(ai%2)));
      al.y=Math.min(th-1, 2+Math.floor(ai/2)*2);
      calcDerived(al); state.units.push(al);
    });
    /* <pos>站位覆盖 + 记录已处理的spawn楼层ID（防重复） */
    if(opts.posText)applyPositions(state,opts.posText);
    if(opts.spawnMsgId!=null&&opts.spawnMsgId!==''){ state.spawnHandledMsgIds=[opts.spawnMsgId]; }
    addLog(state,'-- 战斗开始 · 回合1 --');
    var initReport=buildReport(state,'战斗开始！'+state.units.map(function(u){return u.name+' HP'+u.hp+'/'+u.derived.hpMax;}).join(' vs '),'','战斗开始');
    addLog(state,initReport);
    saveCombatState(state);
    /* 消息体只放 <CombatHud/>，战报进state.log，控制台从state渲染 */
    /* 不注入新楼层：战斗面板由复合控制台挂载到当前楼层 */
    saveCombatState(state);
    return state;
  }
  HOST.enterCombat=enterCombat;
  HOST.CombatV6={
    nebDice:nebDice, evalDiceStr:evalDiceStr, lookupDB:lookupDB, profBonus:profBonus,
    resolveAttack:resolveAttack, resolveAOEAttack:resolveAOEAttack, calcDerived:calcDerived, buildBuffedContext:buildBuffedContext,
    seedPlayer:seedPlayer, makeEnemy:makeEnemy, makeAlly:makeAlly, fetchStatData:fetchStatData,
    readSkillCards:readSkillCards, readEquipmentCards:readEquipmentCards, readConsumableCards:readConsumableCards, getEquippedSlots:getEquippedSlots,
    doPlayerAttack:doPlayerAttack, doSkill:doSkill, doDodge:doDodge, doParry:doParry, doMove:doMove, doFreeRoll:doFreeRoll, doCustomAction:doCustomAction, doUseConsumable:doUseConsumable, doCounter:doCounter, doDualWield:doDualWield, doThrow:doThrow,
    addBuff:addBuff, removeBuff:removeBuff, adjustHP:adjustHP, markDodge:markDodge, markParry:markParry, consumeDodge:consumeDodge, consumeParry:consumeParry,
    endTurn:endTurn, tick:tick, addActionToQueue:addActionToQueue, resolveUnitDecision:resolveUnitDecision, resolveUnitSkill:resolveUnitSkill,
    buildReport:buildReport, buildBattleSnapshot:buildBattleSnapshot, buildRosterLoreSnippet:buildRosterLoreSnippet, appendCombatToLayer:appendCombatToLayer,
    callAI:callAI, cleanAIReply:cleanAIReply, parseDigest:parseDigest, processAIReply:processAIReply, executePlayerAction:executePlayerAction,
    resolveEnemyAction:resolveEnemyAction, resolveAllyAction:resolveAllyAction, parseEnemyAction:parseEnemyAction, parseAllyAction:parseAllyAction, parseEnemySpawn:parseEnemySpawn, parseAllySpawn:parseAllySpawn, parseEnemyLogic:parseEnemyLogic, parseAllyLogic:parseAllyLogic, parseScriptBlock:parseScriptBlock, checkEnemySpawn:checkEnemySpawn,
    decideUnitAction:decideUnitAction, evaluateCondition:evaluateCondition, selectTarget:selectTarget, safeRunScript:safeRunScript, getMainTarget:getMainTarget,
    getCharacterRoster:getCharacterRoster, saveCharacterRoster:saveCharacterRoster, addToRoster:addToRoster, updateRosterEntry:updateRosterEntry, removeFromRoster:removeFromRoster, addToRosterFromSpawn:addToRosterFromSpawn, syncRosterToWorldInfo:syncRosterToWorldInfo, removeRosterWorldInfo:removeRosterWorldInfo,
    getCombatState:getCombatState, saveCombatState:saveCombatState, clearCombatState:clearCombatState, checkCombatEnd:checkCombatEnd, finalizeCombatMessage:finalizeCombatMessage,
    distance:distance, inRange:inRange, unitsInAOE:unitsInAOE, ATTRS:ATTRS, ROLL_TARGETS:ROLL_TARGETS, WEAPON_RANGE:WEAPON_RANGE,
    parseTerrain:parseTerrain, terrainAt:terrainAt, inLineOfSight:inLineOfSight, pathfind:pathfind, getTerrainAttackMods:getTerrainAttackMods, triggerTrap:triggerTrap, checkTerrainCondition:checkTerrainCondition,
    startCombatSession:startCombatSession, enterCombat:enterCombat, combatAction:HOST.combatAction,
    renderCombatPanel:renderCombatPanel,
    getAttackMode:getAttackMode, weaponAOERadius:weaponAOERadius,
    parsePositions:parsePositions, applyPositions:applyPositions, buildPositionsBlock:buildPositionsBlock,
    undoPendingAction:undoPendingAction, requeueMarks:requeueMarks
  };

  console.log('[多维矩阵·战斗引擎] v6.2 已加载（真同层+地形系统A6+角色管理tab+编年史支持+战斗结束摘要回归非同层）');
})();
