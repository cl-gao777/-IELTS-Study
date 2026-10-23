/** Browser regression check. Supply a Playwright Page pointed at an isolated Studio server.
 * The function has no package dependency; it can be passed to playwright-cli run-code.
 * It navigates pages only and never submits a study answer or changes settings.
 */
export default async function checkNavigation(page) {
  const origin=new URL(page.url()).origin;
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('Use a local isolated QA server');
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/');
  const summary=page.locator('header summary');
  await summary.waitFor();
  await summary.focus();await page.keyboard.press('ArrowDown');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('href')==='/review');
  await page.keyboard.press('End');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('href')==='/settings');
  await page.keyboard.press('Home');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('href')==='/review');
  await page.keyboard.press('Escape');
  check(await summary.evaluate(el=>document.activeElement===el && !el.parentElement.open),'Escape must close More and restore focus');
  await summary.click();await page.getByRole('heading',{level:1}).click();
  check(await summary.evaluate(el=>!el.parentElement.open),'Outside click must close More');
  await summary.click();await page.getByRole('navigation',{name:'更多页面'}).getByRole('link',{name:'设置',exact:true}).focus();
  await page.keyboard.press('Tab');
  check(await summary.evaluate(el=>!el.parentElement.open),'Tab leaving More must close it');
  await summary.click();await page.getByRole('navigation',{name:'更多页面'}).getByRole('link',{name:'学习材料',exact:true}).click();
  await page.waitForURL('**/materials');
  check(await page.locator('header a[href="/materials"][aria-current="page"]').count()===1,'More must retain the active destination');
  await page.setViewportSize({width:320,height:900});
  const trigger=page.getByRole('button',{name:'打开导航菜单',exact:true});
  await trigger.click();
  const drawer=page.getByRole('dialog',{name:'工作台导航'});
  await drawer.waitFor();
  const close=drawer.getByRole('button',{name:'关闭导航菜单'});
  await drawer.getByRole('link',{name:'设置 Settings',exact:true}).focus();
  await page.keyboard.press('Tab');
  check(await close.evaluate(el=>document.activeElement===el),'Drawer must wrap Tab to its first control');
  await page.keyboard.press('Escape');
  check(await trigger.evaluate(el=>document.activeElement===el),'Drawer must return focus on Escape');
  await trigger.click();await page.mouse.click(315,200);
  check(await page.locator('dialog[open]').count()===0,'Backdrop must close the drawer');
  await trigger.click();await drawer.getByRole('link',{name:'词根词缀 Word formation',exact:true}).click();
  await page.waitForURL('**/morphology');
  check(await page.locator('dialog[open]').count()===0,'Navigation must close the drawer');
  for(const width of [320,768,1024,1366,1440]){
    await page.setViewportSize({width,height:768});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Navigation overflow at ${width}`);
  }
  return {moreKeyboard:true,outsideClick:true,tabExit:true,drawerFocus:true,backdrop:true,navigation:true,widths:[320,768,1024,1366,1440]};
}
