// Run: node tests/daily-record.cjs (Playwright and Chromium required).
// Firebase is isolated: no real accounts or database writes are used.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const legacy = { id: 1, date: '2026-11-01', hasMorning: true, morningMood: 'すっきり', schoolAttendance: 'すんなり', morningMemo: '古い朝メモ', hasEvening: true, bedtime: '21:30', activities: ['読書'], routineIssues: ['宿題'], intensity: '少し', praisePoints: '頑張った', notes: '古い夜メモ', unknownField: { keep: true } };
(async () => {
 const server = http.createServer((req,res) => {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'../index.html')));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
 browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true,args:['--no-sandbox']});
 const page = await browser.newPage();
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());return d.accept();});
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.includes('firebase-app-compat.js')) return route.fulfill({contentType:'application/javascript',body:`
   window.testEntries = ${JSON.stringify([legacy])}; window.testFail = false; window.testActivityOptions = null;
   const snap = value => ({val:()=>JSON.parse(JSON.stringify(value))});
   window.testRootExtras = { profile: { marker: 'preserve' }, schedules: [{week:'2026-11-02',dayOfWeek:1,title:'existing schedule'}], analyses:[{id:'existing',text:'preserve'}] };
   window.testRootWriteCalls = 0;
   const ref = {transaction(update) {
    window.testRootWriteCalls++;
    const execute = () => {
     if(window.testFail)return Promise.reject(new Error('offline'));
     let latest={...window.testRootExtras,entries:window.testEntries,activityOptions:window.testActivityOptions};
     let value=update(latest);
     if(window.testRestoreRace){
      window.testRestoreRace=false;
      window.testEntries=[...window.testEntries,{id:987,date:'2026-10-29',notes:'concurrent addition',hasEvening:true}];
      latest={...window.testRootExtras,entries:window.testEntries,activityOptions:window.testActivityOptions};
      value=update(latest);
     }
     if(value===undefined)return Promise.resolve({committed:false});
     window.testEntries=value.entries;window.testActivityOptions=value.activityOptions;window.testRootExtras=value;
     return Promise.resolve({committed:true,snapshot:snap(value)});
    };
    if(window.testDefer)return new Promise((resolve,reject)=>{window.testRelease=()=>execute().then(resolve,reject);});
    return execute();
   },child(name) {return {
    once(type, callback) {const s=snap(name==='entries'?window.testEntries:name==='activityOptions'?window.testActivityOptions:[]);if(callback)callback(s);return Promise.resolve(s);},
    on() {},
    set(data) {if(name==='entries')window.testEntries=data;return Promise.resolve();},
    transaction(update) {
     const execute=()=>{if(window.testFail)return Promise.reject(new Error('offline'));const value=update(name==='entries'?window.testEntries:window.testActivityOptions);if(value===undefined)return Promise.resolve({committed:false});if(name==='entries')window.testEntries=value;else window.testActivityOptions=value;return Promise.resolve({committed:true,snapshot:snap(value)});};
     if(window.testDefer)return new Promise((resolve,reject)=>{window.testRelease=()=>execute().then(resolve,reject);});
     return execute();
    }
   };}};
   window.firebase={initializeApp(){},auth:()=>({onAuthStateChanged(cb){setTimeout(()=>cb({uid:'test',email:'test@example.invalid'}),0);}}),database:()=>({ref:()=>ref})};
  `});
  if(url.includes('gstatic.com/firebasejs')) return route.fulfill({contentType:'application/javascript',body:''});
  if(url.startsWith('http://127.0.0.1:')) return route.continue();
  return route.fulfill({contentType:'text/css',body:''});
 });
 const url=`http://127.0.0.1:${server.address().port}`;
 await page.goto(url);
 await page.waitForFunction(()=>!document.getElementById('dailySaveButton').disabled);
 assert.equal(await page.locator('#dailyTab').isVisible(),true);
 assert.equal(await page.locator('.tab').count(),5);
 assert.deepEqual(await page.locator('#dailySchoolStatus option').allTextContents(),['学校','休日']);
 await page.waitForFunction(()=>document.querySelectorAll('#dailyActivities input').length===4);
 await page.evaluate(()=>showTab('settings'));
 await page.locator('#newActivityName').fill('スイミング');
 await page.locator('#activitySettingsForm button').click();
 await page.waitForFunction(()=>document.getElementById('activitySettingsStatus').textContent.includes('保存しました'));
 assert.equal(await page.locator('#activitySettingsList .activity-setting-row').count(),5);
 await page.locator('#newActivityName').fill('スイミング');
 await page.locator('#activitySettingsForm button').click();
 await page.waitForFunction(()=>document.getElementById('activitySettingsStatus').textContent.includes('すでにあります'));
 assert.equal(await page.locator('#activitySettingsList .activity-setting-row').count(),5);

 await page.evaluate(()=>showTab('history'));
 await page.getByTitle('編集',{exact:true}).click();
 assert.equal(await page.locator('#dailyBedtime').inputValue(),'21:30');
 await page.locator('#dailyWakeTime').fill('07:15');
 await page.locator('#dailyActivities label').filter({hasText:'放課後デイ'}).locator('input').check();
 await page.locator('#dailyActivities label').filter({hasText:'スイミング'}).locator('input').check();
 await page.locator('#dailySchoolStatus').selectOption('school_day');
 await page.locator('#dailyPeriodCount').selectOption('6');
 for(const n of [2,3,4]) await page.locator('#period'+n).check();
 await page.locator('#dailyMorning').selectOption('reluctant');
 await page.locator('#dailyFatigue').selectOption('tired');
 const concerns='<img src=x onerror="window.injected=true">\n少し疲れている';
 await page.locator('#dailyConcerns').fill(concerns);
 // Another device adds a record after the form loads; saving must retain it.
 await page.evaluate(()=>window.testEntries.push({id:2,date:'2026-10-31',notes:'別の端末の記録',hasEvening:true}));
 await page.locator('#dailySaveButton').click();
 await page.waitForFunction(()=>document.getElementById('historyTab').style.display==='block');
 const saved=await page.evaluate(()=>window.testEntries);
 assert.deepEqual(Object.fromEntries(Object.entries(saved.find(e=>e.id===1)).filter(([k])=>k!=='dailyRecord')),legacy);
 assert.equal(saved.length,2);
 assert.equal(saved[0].dailyRecord.wakeTime,'07:15');
 assert.equal(saved[0].dailyRecord.concerns,concerns);
 assert.deepEqual(saved[0].dailyRecord.extracurricular.map(item=>item.name),['放課後デイ','スイミング']);
 assert.equal(await page.locator('#historyList img').count(),0);
 assert.match(await page.locator('#historyList').innerText(),/古い朝メモ/);
 assert.match(await page.locator('#historyList').innerText(),/古い夜メモ/);
 await page.evaluate(()=>showTab('settings'));
 await page.getByRole('button',{name:'スイミングを削除',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('activitySettingsStatus').textContent.includes('保存しました'));
 assert.equal(await page.locator('#activitySettingsList .activity-setting-row').count(),4);
 assert.equal(await page.evaluate(()=>window.testEntries[0].dailyRecord.extracurricular[1].name),'スイミング');
 await page.evaluate(()=>editEntry('2026-11-01'));
 assert.equal(await page.locator('#dailyActivities label').filter({hasText:'スイミング（削除済み）'}).locator('input').isChecked(),true);

 assert.deepEqual((await page.evaluate(()=>window.testEntries))[0].dailyRecord.school.attendedPeriods,[2,3,4]);
 assert.equal(await page.locator('#period2').isChecked(),true);
 await page.locator('#dailyConcerns').fill('追記');
 await page.locator('#dailySaveButton').click();
 await page.waitForFunction(()=>document.getElementById('historyTab').style.display==='block');
 assert.equal((await page.evaluate(()=>window.testEntries)).length,2);
 await page.evaluate(()=>{showTab('daily');document.getElementById('dailyDate').value='2026-11-02';loadDailyEntry('2026-11-02');window.testFail=true;});
 assert.equal(await page.locator('#dailyWakeTime').inputValue(),'');
 await page.locator('#dailyConcerns').fill('失敗しても残るメモ');
 await page.locator('#dailySaveButton').click();
 await page.waitForFunction(()=>document.getElementById('dailySaveStatus').textContent.includes('保存できません'));
 assert.equal(await page.locator('#dailyConcerns').inputValue(),'失敗しても残るメモ');
 assert.equal((await page.evaluate(()=>window.testEntries)).length,2);
 await page.evaluate(()=>window.testFail=false);
 await page.locator('#dailyConcerns').fill('');
 await page.locator('#dailySaveButton').click();
 await page.waitForFunction(()=>document.getElementById('historyTab').style.display==='block');
 assert.equal((await page.evaluate(()=>window.testEntries)).length,3);
 await page.evaluate(()=>{showTab('analysis');document.getElementById('analysisStartDate').value='2026-10-01';document.getElementById('analysisEndDate').value='2026-11-30';exportDataForAnalysis();});
 const exported=await page.locator('#exportContent').inputValue();
 assert.match(exported,/起床時間: 07:15/);assert.match(exported,/古い朝メモ/);assert.match(exported,/2・3・4時間目に参加/);assert.match(exported,/気が重そう/);
 const downloadPromise=page.waitForEvent('download');
 await page.evaluate(()=>backupData());
 const download=await downloadPromise;
 const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
 assert.deepEqual(backup.data.entries,await page.evaluate(()=>window.testEntries));
 assert.deepEqual(backup.data.activityOptions,await page.evaluate(()=>window.testActivityOptions));
 assert.match(exported,/課外活動: 放課後デイ、スイミング/);
 // Distinguish no participation, unknown, holiday, and absence.
 for(const [date,schoolStatus,participation] of [['2026-11-03','school_day','none'],['2026-11-04','school_day','unknown'],['2026-11-05','holiday','unknown'],['2026-11-06','holiday','unknown']]) {
  await page.evaluate(date=>{showTab('daily');document.getElementById('dailyDate').value=date;loadDailyEntry(date);},date);
  await page.locator('#dailySchoolStatus').selectOption(schoolStatus);
  if(schoolStatus==='holiday') {
   for(const id of ['dailyWakeTime','dailyBedtime','dailyMorning','dailyFatigue','dailyPeriodCount']) assert.equal(await page.locator('#'+id).isVisible(),false);
   assert.equal(await page.locator('#dailyActivities').isVisible(),true);
   assert.equal(await page.locator('#dailyConcerns').isVisible(),true);
   await page.locator('#dailyActivities label').filter({hasText:'ジム'}).locator('input').check();
   await page.locator('#dailyConcerns').fill('休日はジムへ');
  }

  if(schoolStatus==='school_day') {
   await page.locator('#dailyPeriodCount').selectOption('4');
   assert.equal(await page.locator('#period5').isDisabled(),true);
   if(participation==='none') await page.getByRole('button',{name:'授業への参加なし',exact:true}).click();
  }
  await page.locator('#dailySaveButton').click();
  await page.waitForFunction(()=>document.getElementById('historyTab').style.display==='block');
  const record=await page.evaluate(date=>window.testEntries.find(e=>e.date===date).dailyRecord.school,date);
  assert.equal(record.status,schoolStatus);
  if(schoolStatus==='holiday') {
   const daily=await page.evaluate(date=>window.testEntries.find(e=>e.date===date).dailyRecord,date);
   assert.equal(daily.morningState,undefined); assert.equal(daily.wakeTime,undefined);
   assert.equal(daily.concerns,'休日はジムへ');
   await page.evaluate(date=>editEntry(date),date);
   assert.equal(await page.locator('#dailyMorning').isVisible(),false);
   assert.equal(await page.locator('#dailyActivities label').filter({hasText:'ジム'}).locator('input').isChecked(),true);
   await page.locator('#dailySchoolStatus').selectOption('school_day');
   assert.equal(await page.locator('#dailyMorning').isVisible(),true);
   await page.locator('#dailySchoolStatus').selectOption('holiday');
  }

  assert.equal(record.participationRecorded,participation==='none');
  // Firebase may omit empty arrays. The explicit flag must still distinguish zero from unknown.
  if(participation==='none') {
   assert.equal(await page.evaluate(record=>schoolSummary({school:{...record,attendedPeriods:null}}),record),'学校の日／授業への参加なし');
  }
 }
 // Delete against a stale local list, preserving a newer remote record.
 await page.evaluate(()=>{
  localStorage.setItem('childDailyEntries',JSON.stringify(window.testEntries.filter(e=>e.date!=='2026-10-31')));
  window.testFail=true;
 });
 const cacheBeforeDelete=await page.evaluate(()=>localStorage.getItem('childDailyEntries'));
 await page.evaluate(()=>deleteEntry('2026-11-04'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('childDailyEntries')),cacheBeforeDelete);
 assert.equal(await page.evaluate(()=>window.testEntries.some(e=>e.date==='2026-11-04')),true);
 await page.evaluate(()=>{window.testFail=false;window.testDefer=true;window.testRelease=null;void deleteEntry('2026-11-04');});
 await page.waitForFunction(()=>typeof window.testRelease==='function');
 assert.equal(await page.evaluate(()=>localStorage.getItem('childDailyEntries')),cacheBeforeDelete);
 assert.equal(await page.evaluate(()=>window.testEntries.some(e=>e.date==='2026-11-04')),true);
 await page.evaluate(()=>{window.testDefer=false;window.testRelease();});
 await page.waitForFunction(()=>!recordMutationInProgress);
 assert.equal(await page.evaluate(()=>window.testEntries.some(e=>e.date==='2026-11-04')),false);
 assert.equal(await page.evaluate(()=>window.testEntries.some(e=>e.date==='2026-10-31')),true);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('childDailyEntries')).some(e=>e.date==='2026-10-31')),true);

 // Loading guard prevents both delete and restore writes.
 await page.evaluate(()=>{dailyEntriesReady=false;});
 const beforeGuard=await page.evaluate(()=>JSON.stringify(window.testEntries));
 await page.evaluate(()=>deleteEntry('2026-11-01'));
 assert.equal(await page.evaluate(()=>JSON.stringify(window.testEntries)),beforeGuard);
 await page.evaluate(()=>{dailyEntriesReady=true;showTab('settings');});

 const restoreFile = data => ({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
 // Invalid backup must not alter cloud or local cache.
 const beforeInvalid=await page.evaluate(()=>({cloud:JSON.stringify(window.testEntries),local:localStorage.getItem('childDailyEntries'),writes:window.testRootWriteCalls}));
 await page.locator('#restoreFileInput').setInputFiles(restoreFile({data:{entries:[{date:'not-a-date'}]}}));
 await page.waitForFunction(()=>document.getElementById('restoreStatus').textContent.includes('形式が正しくありません'));
 assert.deepEqual(await page.evaluate(()=>({cloud:JSON.stringify(window.testEntries),local:localStorage.getItem('childDailyEntries'),writes:window.testRootWriteCalls})),beforeInvalid);

 // Permission/network failure: no success, no local overwrite, no reload.
 await page.evaluate(()=>window.testFail=true);
 await page.locator('#restoreFileInput').setInputFiles(restoreFile({data:{entries:[{date:'2026-10-28',notes:'failed restore'}]}}));
 await page.waitForFunction(()=>document.getElementById('restoreStatus').textContent.includes('完了を確認できません'));
 assert.equal(await page.evaluate(()=>JSON.stringify(window.testEntries)),beforeInvalid.cloud);
 assert.equal(await page.evaluate(()=>localStorage.getItem('childDailyEntries')),beforeInvalid.local);

 // Restore retries on a newer root snapshot, preserving all unrelated records and sections.
 await page.evaluate(()=>{window.testFail=false;window.testDefer=true;window.testRestoreRace=true;window.testRelease=null;});
 const dialogCount=dialogs.length;
 await page.locator('#restoreFileInput').setInputFiles(restoreFile({data:{entries:[{date:'2026-11-01',dailyRecord:{concerns:'atomic restore'}}],analyses:[{id:'added',text:'new'}],schedules:[{week:'2026-11-02',dayOfWeek:2,title:'new schedule'}]}}));
 await page.waitForFunction(()=>typeof window.testRelease==='function');
 assert.equal(await page.evaluate(()=>localStorage.getItem('childDailyEntries')),beforeInvalid.local);
 assert.equal(dialogs.slice(dialogCount).some(message=>message==='データを復元しました。'),false);
 await page.evaluate(()=>{window.testDefer=false;window.testRelease();});
 await page.waitForFunction(()=>document.getElementById('restoreStatus').textContent.includes('復元が完了'));
 assert.equal(await page.evaluate(()=>window.testEntries.some(e=>e.date==='2026-10-29')),true);
 assert.equal(await page.evaluate(()=>window.testEntries.find(e=>e.id===1).dailyRecord.wakeTime),'07:15');
 assert.equal(await page.evaluate(()=>window.testRootExtras.profile.marker),'preserve');
 assert.equal(await page.evaluate(()=>window.testRootExtras.analyses.length),2);
 assert.equal(await page.evaluate(()=>window.testRootExtras.schedules.length),2);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('weeklyAnalyses')).length),2);
 assert.equal(dialogs.slice(dialogCount).filter(message=>message==='データを復元しました。').length,1);
 // A legacy backup of the same date must not remove the new fields.
 await page.locator('#restoreFileInput').setInputFiles({name:'legacy-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({data:{entries:[{...legacy,morningMemo:'復元した朝メモ'}]}}))});
 await page.waitForFunction(()=>window.testEntries.find(e=>e.id===1).morningMemo==='復元した朝メモ');
 const restored=await page.evaluate(()=>window.testEntries.find(e=>e.id===1));
 assert.equal(restored.dailyRecord.wakeTime,'07:15');
 assert.equal(restored.dailyRecord.concerns,'atomic restore');
 assert.equal(restored.morningMemo,'復元した朝メモ');
 // Exact reported date range: every stored date inside both boundaries must be exported.
 const rangeOutput = await page.evaluate(() => {
  const previous = localStorage.getItem('childDailyEntries');
  try {
   const entries = [];
   for (let day = new Date('2026-10-21T00:00:00Z'); day <= new Date('2026-11-06T00:00:00Z'); day.setUTCDate(day.getUTCDate() + 1)) {
    entries.push({ date: day.toISOString().slice(0,10), hasEvening: true, activities: ['学校'], notes: '期間テスト' });
   }
   localStorage.setItem('childDailyEntries', JSON.stringify(entries));
   showTab('analysis');
   document.getElementById('analysisStartDate').value='2026-10-22';
   document.getElementById('analysisEndDate').value='2026-11-05';
   exportDataForAnalysis();
   return document.getElementById('exportContent').value;
  } finally { localStorage.setItem('childDailyEntries', previous); }
 });
 assert.match(rangeOutput,/記録日数: 15日分/);
 assert.equal((rangeOutput.match(/^■ /gm)||[]).length,15);
 assert.match(rangeOutput,/■ 2026-10-22/); assert.match(rangeOutput,/■ 2026-11-05/);
 assert.doesNotMatch(rangeOutput,/■ 2026-10-21|■ 2026-11-06/);
 assert.deepEqual(errors,[]);
 console.log('PASS: legacy preservation, concurrent record merge, new/edit/partial records, date switching, failed save/retry, safe text rendering, export, full JSON backup, legacy backup restore, safe delete/restore with stale data and transaction retries, failure and loading guards; no live Firebase writes.');
 } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
