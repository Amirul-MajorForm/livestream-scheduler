/**
 * MAJORFORM LIVESTREAM SCHEDULER V7
 * Replace the old scheduler function with this entire file (including helpers).
 * Inputs: Rules, Capacity, Commitment, Host_Availability, Host_Preferences,
 *         Pre_Planned_Streams (all brands in one tab).
 * Output: Schedule + Scheduling_Summary (overwrite), or numbered output pairs (keep previous).
 * All automatically allocated streams MUST have an eligible, available host.
 * Preplanned bookings are preserved, even when they exceed commitments. Blank-host bookings get an eligible host where possible.
 * Odd-hour bookings reserve overlapping hosts/rooms; unhosted bookings still reserve rooms.
 * Host brand AND platform eligibility are hard constraints; blank eligibility is denied.
 */
function generateDynamicLivestreamSchedule() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  // Output management: preserve an edited schedule when requested.
  // YES = overwrite the main output pair; NO = retain all prior versions and create a new pair.
  // CANCEL = do not run or change any sheets.
  const outputChoice = ui.alert(
    'Schedule Output',
    'YES — Override the current Schedule and Scheduling_Summary.\n\n' +
    'NO — Keep all existing schedules and create a NEW numbered version for comparison.\n\n' +
    'CANCEL — Exit without running.',
    ui.ButtonSet.YES_NO_CANCEL
  );
  if (outputChoice === ui.Button.CANCEL || outputChoice === ui.Button.CLOSE) return;
  const baseSchedule = 'Schedule';
  const baseSummary = 'Scheduling_Summary';
  let scheduleName = baseSchedule;
  let summaryName = baseSummary;
  if (outputChoice === ui.Button.NO && (ss.getSheetByName(baseSchedule) || ss.getSheetByName(baseSummary))) {
    let version = 2;
    while (ss.getSheetByName(baseSchedule + '_v' + version) ||
           ss.getSheetByName(baseSummary + '_v' + version)) version++;
    scheduleName = baseSchedule + '_v' + version;
    summaryName = baseSummary + '_v' + version;
  }
  const required = ['Rules', 'Capacity', 'Commitment', 'Host_Availability', 'Host_Preferences', 'Pre_Planned_Streams'];
  const missing = required.filter(n => !ss.getSheetByName(n));
  if (missing.length) { ui.alert('Missing required tabs: ' + missing.join(', ')); return; }

  const slots = ['10AM-12PM','12PM-2PM','2PM-4PM','4PM-6PM','6PM-8PM','8PM-10PM','10PM-12MN'];
  const startMins = [600,720,840,960,1080,1200,1320];
  const rooms = ['Yellow Room','Blue Room','Main Room','Dakota','Tanah Merah'];
  const daysShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const warnings = [];
  const errors = [];
  const norm = x => String(x == null ? '' : x).trim().toLowerCase();
  const str = x => String(x == null ? '' : x).trim();
  const number = x => Number(x);
  const isYes = x => x === true || x === 1 || ['true','y','yes','1'].includes(norm(x));
  const key = (a,b) => a + '||' + b;
  // A combined platform is ONE simultaneous stream, requiring both platform skills.
  // Accept either the comma-separated host format or the ampersand commitment format.
  const parsePlatforms = value => {
    const raw = norm(value).replace(/\band\b/g, ',').replace(/&/g, ',');
    const parts = raw.split(',').map(x => x.trim()).filter(Boolean);
    const valid = parts.length > 0 && parts.every(x => x === 'tiktok' || x === 'shopee');
    return valid ? new Set(parts) : null;
  };
  const platformMatch = (hostPlatforms, required) => {
    const needed = parsePlatforms(required);
    return !!needed && !!hostPlatforms && [...needed].every(p => hostPlatforms.has(p));
  };
  const data = name => ss.getSheetByName(name).getDataRange().getValues();
  const ruleRows = data('Rules');
  const rules = {};
  ruleRows.forEach(r => { if (str(r[0])) rules[norm(r[0])] = r[1]; });
  const monthValue = rules['month'];
  let year, month;
  if (monthValue instanceof Date && !isNaN(monthValue.getTime())) {
    year = monthValue.getFullYear(); month = monthValue.getMonth();
  } else {
    const parts = str(monthValue).split(/\s+/);
    month = monthNames.findIndex(n => norm(n) === norm(parts[0]));
    year = Number(parts[1]);
  }
  if (month < 0 || !Number.isInteger(year) || year < 2020 || year > 2100) {
    ui.alert('Invalid Rules > Month. Use a date cell or e.g. "November 2026". No output was changed.'); return;
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dateLabel = d => d + ' ' + monthNames[month].slice(0,3) + ' ' + year;
  const parseDay = value => {
    if (value instanceof Date && !isNaN(value.getTime())) {
      if (value.getMonth() !== month || value.getFullYear() !== year) return null;
      return value.getDate();
    }
    const s = str(value);
    if (!s) return null;
    let m = s.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
    if (m) {
      if (norm(m[2]).slice(0,3) !== norm(monthNames[month]).slice(0,3) || Number(m[3]) !== year) return null;
      return Number(m[1]);
    }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return Number(m[1]) === year && Number(m[2]) === month+1 ? Number(m[3]) : null;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return Number(m[2]) === month+1 && Number(m[3]) === year ? Number(m[1]) : null;
    return null;
  };
  const parseStart = value => {
    if (value instanceof Date && !isNaN(value.getTime())) return value.getHours()*60+value.getMinutes();
    if (typeof value === 'number') return value >= 0 && value < 1 ? Math.round(value*1440) : value < 24 ? value*60 : value;
    const s = str(value).toUpperCase();
    let m = s.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/);
    if (m) {
      let h = Number(m[1]);
      if (m[3]) h = (h % 12) + (m[3] === 'PM' ? 12 : 0);
      return h*60 + Number(m[2]);
    }
    if (/^\d{1,2}$/.test(s)) return Number(s)*60;
    m=s.match(/^(\d{1,2})\s*(AM|PM)$/);
    if(m) return ((Number(m[1])%12)+(m[2]==='PM'?12:0))*60;
    return null;
  };
  const getPct = (x, fallback) => {
    if (x === '' || x == null) return fallback;
    let v = parseFloat(x);
    if (str(x).includes('%') || v > 1) v /= 100;
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
  };
  const pctLimits = {
    bau: [getPct(rules['maximum day slots for bau weekday'],.20),getPct(rules['maximum day slots for bau weekend'],.50)],
    mega: [getPct(rules['maximum day slots for mega weekday'],.20),getPct(rules['maximum day slots for mega weekend'],.50)]
  };

  const roomStatus = {};
  data('Capacity').slice(1).forEach(r => { if (str(r[0])) roomStatus[norm(r[0])] = norm(r[4]) || 'available'; });
  const roomAllowed = room => (roomStatus[norm(room)] || 'available') !== 'unavailable';
  const permissions = {};
  ruleRows.slice(1).forEach(r => {
    const host = str(r[3]); if (!host) return;
    const raw = norm(r[4]);
    permissions[host] = !raw || raw === 'all' ? null : raw.split(',').map(x=>x.trim());
  });
  const canUseRoom = (host,room) => !permissions[host] || permissions[host].includes(norm(room));
  const megaDates = {};
  ruleRows.slice(1).forEach(r => {
    const sale = norm(r[6]), day = Number(r[7]);
    if (sale && Number.isInteger(day) && day>=1 && day<=daysInMonth) megaDates[day] = sale;
  });

  const av = data('Host_Availability');
  const hosts = av[0].slice(4).map(str).filter(Boolean);
  if (new Set(hosts).size !== hosts.length) errors.push('Duplicate host names in Host_Availability header.');
  const available = {};
  av.slice(1).forEach((r,i) => {
    const day = parseDay(r[0]), slot = slots.indexOf(str(r[3]));
    if (day == null || day < 1 || day > daysInMonth || slot < 0) return;
    const k = key(day,slot);
    if (!available[k]) available[k] = new Set();
    hosts.forEach((h,j) => { if (isYes(r[j+4])) available[k].add(h); });
  });
  const preferences = {}, caps = {}, brandCaps = {}, gender = {}, platforms = {};
  const pref = data('Host_Preferences');
  const prefHosts = pref[0].slice(1).map(str);
  pref.slice(1).forEach(r => {
    const label = norm(r[0]); if (!label) return;
    prefHosts.forEach((h,j) => {
      if (!h) return;
      const raw = r[j+1];
      if (label === 'gender') gender[h] = norm(raw);
      else if (label === 'platforms') platforms[h] = parsePlatforms(raw);
      else if (['max_streams_month','max streams','monthly cap'].includes(label)) {
        if (raw !== '' && raw != null && Number.isInteger(Number(raw)) && Number(raw)>=0) caps[h] = Number(raw);
      } else if (['max_brand_pct','brand cap','max brand %'].includes(label)) {
        if (raw !== '' && raw != null) brandCaps[h] = getPct(raw, NaN);
      } else {
        const v = norm(raw);
        preferences[key(label,h)] = ['preferred','p','1','yes'].includes(v) ? 'preferred' :
          ['regular','r','eligible','allowed'].includes(v) ? 'regular' : 'excluded';
      }
    });
  });
  hosts.forEach(h => {
    if (!(h in caps)) errors.push('Host "'+h+'" has no valid max_streams_month in Host_Preferences.');
    if (!(h in brandCaps) || !Number.isFinite(brandCaps[h]) || brandCaps[h] <= 0)
      errors.push('Host "'+h+'" has no valid positive max_brand_pct in Host_Preferences.');
    if (!prefHosts.includes(h)) errors.push('Host "'+h+'" is missing from Host_Preferences header.');
    if (!platforms[h] || !platforms[h].size) errors.push('Host "'+h+'" has no platforms configured in Host_Preferences (use TikTok, Shopee, or TikTok, Shopee).');

  });

  const commitments = [];
  data('Commitment').slice(1).forEach((r,i) => {
    if (!str(r[0]) && !str(r[4])) return;
    const brand = str(r[0]), period = norm(r[1]), sale = norm(r[2]) || '-', platform = str(r[3]);
    const qty = Number(r[4]), priority = Number(r[5]);
    if (!brand || !['bau','mega'].includes(period) || !Number.isInteger(qty) || qty<0 || !platform) {
      errors.push('Invalid Commitment row '+(i+2)+' (brand, BAU/mega, platform, nonnegative integer sessions required).'); return;
    }
    if (!parsePlatforms(platform)) { errors.push('Unsupported platform in Commitment row '+(i+2)+': '+platform); return; }
    commitments.push({id:i,brand,period,sale,platform,qty,priority:Number.isFinite(priority)&&priority>0?priority:3});
  });
  const brandTotals = {};
  commitments.forEach(c => { brandTotals[norm(c.brand)] = (brandTotals[norm(c.brand)]||0)+c.qty; });
  const brandCapCount = (host,brand) => Math.ceil((brandTotals[norm(brand)]||0)*brandCaps[host]);
  const eligible = (host,brand,platform) => ['regular','preferred'].includes(preferences[key(norm(brand),host)]) &&
    platformMatch(platforms[host],platform);

  const grid = [];
  let bauDay = 0;
  for (let d=1;d<=daysInMonth;d++) {
    const date = new Date(year,month,d), weekend=[0,6].includes(date.getDay());
    const period = megaDates[d] ? 'mega' : 'bau';
    const sale = megaDates[d] || ('day '+(++bauDay));
    for (let s=0;s<slots.length;s++) grid.push({day:d,slot:s,period,sale,weekend,friday:date.getDay()===5});
  }
  const cell = (day,slot) => (day-1)*slots.length+slot;
  const matches = (c,g) => {
    if (c.period !== g.period) return false;
    if (c.sale === 'all' || (c.period==='bau' && c.sale==='-')) return true;
    return c.sale.split(',').map(x=>x.trim()).includes(norm(g.sale));
  };
  // Fixed bookings are an authoritative input, NOT a request for validation against
  // host availability, brand eligibility, caps, or Commitment quantities.
  // Arbitrary times (e.g. 21:00–23:00) are supported and block intersecting slots.
  const preplanned=[];
  const preSheet=ss.getSheetByName('Pre_Planned_Streams');
  if (preSheet.getLastRow()>1) {
    preSheet.getRange(2,1,preSheet.getLastRow()-1,10).getValues().forEach((r,i)=>{
      if (!r.some(x=>str(x))) return;
      const source='Pre_Planned_Streams row '+(i+2);
      const day=parseDay(r[0]),start=parseStart(r[2]),end=parseStart(r[3]);
      const host=str(r[4]),brand=str(r[5]),platform=str(r[8]),requestedRoom=str(r[9]);
      if (!day || day<1 || day>daysInMonth || start==null || end==null ||
          !Number.isFinite(start) || !Number.isFinite(end) || start<0 || end>1440 || end<=start ||
          !brand || !platform) {
        errors.push(source+': missing/invalid date, start/end time, brand or platform.');return;
      }
      // An unknown room is only a suggestion, not a reason to drop a confirmed stream.
      if (!parsePlatforms(platform)) warnings.push(source+': unrecognized platform '+platform+'; retained as confirmed.');
      if(requestedRoom && !rooms.includes(requestedRoom))
        warnings.push(source+': unknown suggested room "'+requestedRoom+'"; another room will be tried.');
      const calPeriod=megaDates[day]?'mega':'bau';
      const declaredPeriod=norm(r[6]);
      const period=['bau','mega'].includes(declaredPeriod)?declaredPeriod:calPeriod;
      if(declaredPeriod && declaredPeriod!==period)
        warnings.push(source+': unrecognized period; using calendar period '+calPeriod+'.');
      preplanned.push({day,start,end,slot:startMins.indexOf(start),host,brand,platform,
        requestedRoom,period,sale:str(r[7])|| (megaDates[day]||' - '),source,fixed:true});
    });
  }
  // Commitment matching happens AFTER assigning hosts to blank-host fixed bookings.
  // Unhosted fixed bookings never count as fulfilled; excess hosted bookings stay in schedule.

  const newState=()=>({items:[],byHost:new Map(),byHostBrand:new Map(),byHostDay:new Map(),byCommit:new Map()});
  const get=(map,k)=>map.get(k)||0;
  const hostDayKey=(h,d)=>key(h,d);
  const interval=p=>({start:p.start!=null?p.start:startMins[p.slot],end:p.end!=null?p.end:startMins[p.slot]+120});
  const overlap=(a,b)=>{
    if(a.day!==b.day)return false;
    const x=interval(a),y=interval(b);
    return x.start<y.end && y.start<x.end;
  };
  const place=(st,p)=>{
    st.items.push(p);
    if (p.host) st.byHost.set(p.host,get(st.byHost,p.host)+1);
    if (p.host) st.byHostBrand.set(key(p.host,norm(p.brand)),get(st.byHostBrand,key(p.host,norm(p.brand)))+1);
    const hd=hostDayKey(p.host,p.day);
    if (p.host) st.byHostDay.set(hd,(st.byHostDay.get(hd)||[]).concat([p]));
    if(p.commitmentId!=null)st.byCommit.set(p.commitmentId,get(st.byCommit,p.commitmentId)+1);
  };
  const remove=(st,p)=>{
    const ix=st.items.indexOf(p);if(ix>=0)st.items.splice(ix,1);
    if (p.host) st.byHost.set(p.host,get(st.byHost,p.host)-1);
    if (p.host) st.byHostBrand.set(key(p.host,norm(p.brand)),get(st.byHostBrand,key(p.host,norm(p.brand)))-1);
    const hd=hostDayKey(p.host,p.day),arr=st.byHostDay.get(hd)||[];
    if (p.host) st.byHostDay.set(hd,arr.filter(x=>x!==p));
    if(p.commitmentId!=null)st.byCommit.set(p.commitmentId,get(st.byCommit,p.commitmentId)-1);
  };
  const validate=(st,p)=>{
    if(!hosts.includes(p.host)||!eligible(p.host,p.brand,p.platform))return false;
    if(!roomAllowed(p.room)||!canUseRoom(p.host,p.room))return false;
    if(!(available[key(p.day,p.slot)]||new Set()).has(p.host))return false;
    if(get(st.byHost,p.host)>=caps[p.host])return false;
    if(get(st.byHostBrand,key(p.host,norm(p.brand)))>=brandCapCount(p.host,p.brand))return false;
    if((st.byHostDay.get(hostDayKey(p.host,p.day))||[]).length>=2)return false;
    // Real interval overlap catches irregular fixed bookings in BOTH adjacent grid slots.
    if(st.items.some(x=>overlap(x,p) &&
        (x.host===p.host || (x.room && x.room===p.room) || norm(x.brand)===norm(p.brand))))return false;
    return true;
  };
  const lockedState=newState();
  // Fixed-host bookings take priority. Blank-host bookings are assigned next, before
  // any flexible commitments, and are NEVER dropped if no host can be found.
  // Room availability is checked against the entire actual time interval.
  const roomFreeFor = (st,p,r) => !st.items.some(x=>x.room===r&&overlap(x,p));
  const roomOptions = (st,p,host) => rooms.filter(r=>roomAllowed(r)&&canUseRoom(host,r)&&roomFreeFor(st,p,r))
    .sort((a,b)=>Number(b===p.requestedRoom)-Number(a===p.requestedRoom)||
      Number(roomStatus[norm(a)]==='last resort')-Number(roomStatus[norm(b)]==='last resort'));
  // Odd-hour bookings must have every intersecting standard availability cell
  // marked available. 9-11pm checks 8-10pm and 10pm-midnight.
  const availableForInterval = (h,p) => {
    const covered=slots.map((_,i)=>i).filter(i=>startMins[i]<p.end && p.start<startMins[i]+120);
    return covered.length>0 && covered.every(i=>(available[key(p.day,i)]||new Set()).has(h));
  };
  const fixedHostBookings=preplanned.filter(p=>p.host);
  const blankHostBookings=preplanned.filter(p=>!p.host);
  fixedHostBookings.sort((a,b)=>rooms.filter(r=>roomAllowed(r)&&canUseRoom(a.host,r)).length-
                               rooms.filter(r=>roomAllowed(r)&&canUseRoom(b.host,r)).length);
  fixedHostBookings.forEach(p=>{
    p.room=roomOptions(lockedState,p,p.host)[0]||'';
    if(!p.room)warnings.push(p.source+': NO ROOM AVAILABLE for fixed booking; retained with blank room. Resolve manually.');
    else if(p.requestedRoom&&p.room!==p.requestedRoom)
      warnings.push(p.source+': requested room '+p.requestedRoom+' changed to '+p.room+'.');
    if(!hosts.includes(p.host))warnings.push(p.source+': fixed host is not in Host_Availability headers; retained.');
    else if(!eligible(p.host,p.brand,p.platform))warnings.push(p.source+': fixed host does not match brand/platform eligibility; retained.');
    if(!hosts.includes(p.host)||!availableForInterval(p.host,p))
      warnings.push(p.source+': fixed host is not marked available for the full booking interval; retained.');
    if(lockedState.items.some(x=>x.host===p.host&&overlap(x,p)))
      warnings.push(p.source+': fixed host has overlapping preplanned bookings; both retained.');
    place(lockedState,p);
    if(hosts.includes(p.host) && get(lockedState.byHost,p.host)>caps[p.host])
      warnings.push(p.source+': fixed bookings exceed this host’s monthly cap; retained.');
  });
  // Assign the most constrained hostless bookings first. A room is reserved even
  // if no host can be assigned, so flexible streams cannot use that room/time.
  const hostChoices = p => {
    const choices=[];
    hosts.forEach(h=>{
      if(!eligible(h,p.brand,p.platform)||!availableForInterval(h,p))return;
      if(get(lockedState.byHost,h)>=caps[h])return;
      // Existing confirmed bookings count toward the brand-share limit.
      const brandCap=Math.max(brandCapCount(h,p.brand),
        preplanned.filter(x=>norm(x.brand)===norm(p.brand)).length);
      if(get(lockedState.byHostBrand,key(h,norm(p.brand)))>=brandCap)return;
      const daily=lockedState.byHostDay.get(hostDayKey(h,p.day))||[];
      if(daily.length>=2 || lockedState.items.some(x=>x.host===h&&overlap(x,p)))return;
      const opts=roomOptions(lockedState,p,h);
      if(!opts.length)return;
      const adjacent=daily.some(x=>interval(x).end===p.start||interval(x).start===p.end);
      const preferred=preferences[key(norm(p.brand),h)]==='preferred';
      const score=(daily.length===0?300:adjacent?30:-180)+(preferred?80:0)
        -get(lockedState.byHost,h)*18-get(lockedState.byHostBrand,key(h,norm(p.brand)))*35;
      choices.push({host:h,room:opts[0],score});
    });
    return choices.sort((a,b)=>b.score-a.score||a.host.localeCompare(b.host));
  };
  blankHostBookings.sort((a,b)=>{
    // Approximate scarcity by eligibility, availability, and room permissions.
    const scarcity=p=>hosts.filter(h=>eligible(h,p.brand,p.platform)&&availableForInterval(h,p)&&
      rooms.some(r=>roomAllowed(r)&&canUseRoom(h,r))).length;
    return scarcity(a)-scarcity(b)||a.day-b.day||a.start-b.start;
  });
  blankHostBookings.forEach(p=>{
    const choice=hostChoices(p)[0];
    if(choice){
      p.host=choice.host;p.room=choice.room;p.autoAssignedHost=true;
    }else{
      p.host='';p.room=roomOptions(lockedState,p,'')[0]||'';
      warnings.push(p.source+': UNASSIGNED HOST — no eligible, available host with sufficient capacity and a compatible free room. Booking retained.');
      if(!p.room)warnings.push(p.source+': NO ROOM AVAILABLE for unhosted fixed booking; retained for manual resolution.');
    }
    if(p.requestedRoom&&p.room&&p.requestedRoom!==p.room)
      warnings.push(p.source+': requested room '+p.requestedRoom+' changed to '+p.room+'.');
    place(lockedState,p);
  });
  // Match only HOSTED fixed streams to positive commitments. Any excess
  // preplanned bookings are kept but do not inflate commitment fulfilment.
  const matched=Object.fromEntries(commitments.map(c=>[c.id,0]));
  preplanned.forEach(p=>{
    if(!p.host)return;
    const g=grid[cell(p.day,0)];
    const found=commitments.filter(c=>norm(c.brand)===norm(p.brand)&&
      parsePlatforms(c.platform)&&parsePlatforms(p.platform)&&
      [...parsePlatforms(c.platform)].sort().join(',')===[...parsePlatforms(p.platform)].sort().join(',')&&
      c.period===p.period&&matches(c,g)&&matched[c.id]<c.qty)
      .sort((a,b)=>a.priority-b.priority)[0];
    if(found){p.commitmentId=found.id;matched[found.id]++;}
  });
  // Rebuild counters because commitment IDs were assigned after room/host locking.
  lockedState.byCommit.clear();
  preplanned.forEach(p=>{if(p.commitmentId!=null)
    lockedState.byCommit.set(p.commitmentId,get(lockedState.byCommit,p.commitmentId)+1);});
  const extraPreplanned=preplanned.filter(p=>p.host&&p.commitmentId==null);
  const unhostedPreplanned=preplanned.filter(p=>!p.host);
  extraPreplanned.forEach(p=>warnings.push(p.source+': EXTRA CONFIRMED STREAM beyond matched commitments; retained in schedule.'));

  if(errors.length){
    ui.alert('Cannot read '+errors.length+' preplanned row(s). No schedules were changed.\n\n' +
      errors.slice(0,12).join('\n') +
      (errors.length>12?'\n...and '+(errors.length-12)+' more.':''));return;
  }

  // Evaluate full candidate (date, slot, host, room), not just a timeslot with one preselected host.
  const score = (st,p,c,run) => {
    const g=grid[cell(p.day,p.slot)], daily=st.byHostDay.get(hostDayKey(p.host,p.day))||[];
    const existingBrand=st.items.filter(x=>x.commitmentId===c.id);
    const hostTotal=get(st.byHost,p.host), brandTotal=get(st.byHostBrand,key(p.host,norm(p.brand)));
    const dayLoads=st.items.filter(x=>x.day===p.day).length;
    const week=Math.floor((p.day-1)/7), weekly=existingBrand.filter(x=>Math.floor((x.day-1)/7)===week).length;
    const dateGap=existingBrand.length?Math.min(...existingBrand.map(x=>Math.abs(x.day-p.day))):7;
    const slotPoints=[10,40,20,30,60,80,5][p.slot];
    let v=slotPoints;
    if (preferences[key(norm(p.brand),p.host)]==='preferred') v+=35;
    v-=hostTotal*22+brandTotal*65;
    if (daily.length) {
      v-=350; // prefer a single stream per day
      if (Math.abs(interval(daily[0]).start-interval(p).start)===120) v+=90; // consecutive better than a gap
      else v-=180+40*Math.max(0,Math.abs(interval(daily[0]).start-interval(p).start)/120-2);
      const otherDoubleDays=[...st.byHostDay.entries()].filter(([k,arr])=>k.startsWith(p.host+'||')&&arr.length>=2).length;
      v-=otherDoubleDays*90;
    }
    v-=weekly*55;
    if (dateGap===0) v-=90;
    else if (dateGap===1) v-=50;
    else if (dateGap===2) v-=20;
    v-=dayLoads*8;
    if (g.friday && g.period==='bau') v-=130;
    if (roomStatus[norm(p.room)]==='last resort') v-=95;
    const dayLimit=pctLimits[c.period][g.weekend?1:0];
    const dayCount=existingBrand.filter(x=>x.slot<5 && grid[cell(x.day,x.slot)].weekend===g.weekend).length;
    if (p.slot<5 && dayCount+1>Math.ceil(c.qty*dayLimit)) v-=80;
    if (['6PM-8PM','8PM-10PM','10PM-12MN'].includes(slots[p.slot]) && gender[p.host]==='female' &&
        !st.items.some(x=>x.day===p.day&&x.slot===p.slot)) v-=90;
    // Deterministic seeded tie-breaker varies by run; avoids always choosing the earliest date.
    const z=(p.day*1013+p.slot*131+p.room.length*47+p.host.length*29+c.id*37+run*8191)>>>0;
    v+=((Math.imul(z^ (z>>>16),2246822519)>>>0)%997)/997*45;
    return v;
  };
  const candidateList = (st,c,run,limit) => {
    const list=[];
    for (const g of grid) {
      if (!matches(c,g)) continue;
      const hs=available[key(g.day,g.slot)]; if (!hs) continue;
      for (const host of hs) {
        if (!eligible(host,c.brand,c.platform)) continue;
        for (const room of rooms) {
          const p={day:g.day,slot:g.slot,host,room,brand:c.brand,platform:c.platform,commitmentId:c.id,fixed:false};
          if (validate(st,p)) list.push({p,score:score(st,p,c,run)});
        }
      }
    }
    list.sort((a,b)=>b.score-a.score);
    return limit ? list.slice(0,limit) : list;
  };
  const copyLocked = () => { const st=newState(); lockedState.items.forEach(p=>place(st,Object.assign({},p))); return st; };
  const remaining = commitments.map(c=>Object.assign({},c,{remaining:c.qty-get(lockedState.byCommit,c.id)}));
  // Constrained commitments first, but mega/priority still influence tie-breaking.
  const difficulty = c => {
    let possibilities=0;
    grid.forEach(g=>{
      if (!matches(c,g)) return;
      const hs=available[key(g.day,g.slot)]||new Set();
      hs.forEach(h=>{if (eligible(h,c.brand,c.platform)&&rooms.some(r=>roomAllowed(r)&&canUseRoom(h,r))) possibilities++;});
    });
    return possibilities/Math.max(1,c.remaining);
  };
  const order = remaining.filter(c=>c.remaining>0).sort((a,b)=>difficulty(a)-difficulty(b) || (a.period==='mega'?-1:1)-(b.period==='mega'?-1:1) || a.priority-b.priority);
  const totalCommitted=commitments.reduce((n,c)=>n+c.qty,0);
  const TRIALS=16;
  let best=null, bestQuality=-Infinity;
  for (let run=0;run<TRIALS;run++) {
    const st=copyLocked();
    const plan=order.slice();
    // Vary tie-order across runs to escape greedy local choices.
    if (run>0) plan.sort((a,b)=>difficulty(a)-difficulty(b) || (((a.id*19+run*11)%13)-((b.id*19+run*11)%13)));
    plan.forEach(c=>{
      while (get(st.byCommit,c.id)<c.qty) {
        const choices=candidateList(st,c,run,run%4===0?1:Math.min(4,1+run%4));
        if (!choices.length) break;
        place(st,choices[run%4===0?0:Math.min(choices.length-1,run%4)].p);
      }
    });
    // One-move repair: relocate an existing generated stream to release a host/room.
    for (let pass=0;pass<2;pass++) {
      let changed=false;
      for (const c of order) {
        if (get(st.byCommit,c.id)>=c.qty) continue;
        const direct=candidateList(st,c,run,1);
        if (direct.length) {place(st,direct[0].p);changed=true;continue;}
        const movable=st.items.filter(x=>!x.fixed);
        for (const old of movable) {
          const oldC=commitments.find(x=>x.id===old.commitmentId);
          remove(st,old);
          const newForOld=candidateList(st,oldC,run+3,12).filter(x=>!(x.p.day===old.day&&x.p.slot===old.slot&&x.p.room===old.room));
          let repaired=false;
          for (const alt of newForOld) {
            place(st,alt.p);
            const target=candidateList(st,c,run,1);
            if (target.length) {place(st,target[0].p);repaired=true;changed=true;break;}
            remove(st,alt.p);
          }
          if (!repaired) place(st,old);
          if (repaired) break;
        }
      }
      if (!changed) break;
    }
    const filled=st.items.filter(x=>x.commitmentId!=null).length;
    const quality=filled*100000+st.items.filter(x=>!x.fixed).reduce((sum,p)=>{
      const c=commitments.find(x=>x.id===p.commitmentId);
      // quality only breaks ties in fulfilment; don't let it override count
      return sum+score(st,p,c,run);
    },0);
    if (quality>bestQuality) {bestQuality=quality;best=st;}
    if (filled===totalCommitted && run>=7) break;
  }

  // Final independent checks before writing output.
  const checked=newState();
  best.items.forEach(p=>{
    if (!p.fixed && !validate(checked,p)) errors.push('Final schedule conflict: '+p.brand+' / '+dateLabel(p.day)+' / '+slots[p.slot]+' / '+p.host);
    place(checked,p);
  });
  commitments.forEach(c=>{if(get(checked.byCommit,c.id)>c.qty) errors.push('Over-allocation for '+c.brand+' / '+c.period);});
  if (errors.length) { ui.alert('Internal validation failed; live schedule was NOT changed:\n'+errors.slice(0,8).join('\n')); return; }

  // Build output in memory; write in batches to avoid slow appendRow loops.
  const formatTime=m=>('0'+Math.floor(m/60)).slice(-2)+':'+('0'+(m%60)).slice(-2);
  const scheduleRows=best.items.slice().sort((a,b)=>a.day-b.day||interval(a).start-interval(b).start||a.room.localeCompare(b.room)).map(p=>{
    const g=grid[cell(p.day,p.fixed?0:p.slot)];
    return [dateLabel(p.day),daysShort[new Date(year,month,p.day).getDay()],
      formatTime(interval(p).start),formatTime(interval(p).end),
      p.host,p.brand,p.fixed?p.period.toUpperCase():g.period.toUpperCase(),p.fixed?p.sale:g.sale,p.platform,p.room];
  });
  const schedule=ss.getSheetByName(scheduleName)||ss.insertSheet(scheduleName);
  schedule.clear();
  const scheduleHeader=['date','day','start time','end time','talent','brand','period','sale','platform','room'];
  schedule.getRange(1,1,1,10).setValues([scheduleHeader]);
  if (scheduleRows.length) schedule.getRange(2,1,scheduleRows.length,10).setValues(scheduleRows);
  schedule.getRange('A1:J1').setFontWeight('bold').setBackground('#e6e6e6');
  schedule.setFrozenRows(1); schedule.autoResizeColumns(1,10);

  // Summary output omitted from this reference copy: see lib/scheduler.ts for the
  // ported summary sections (fulfilment, commitments, deficits with diagnostics,
  // pre-planned assignments, host capacity, room utilization, weekly distribution,
  // validation notes).
  ui.alert('Scheduling complete.');
}
