export function elementSelectionScript(pageId: string): string {
  return `<script>
(() => {
  const root = document.querySelector('.forma-page');
  const highlight = document.createElement('div');
  highlight.style.cssText = 'position:fixed;pointer-events:none;border:3px solid #6366f1;z-index:2147483647;display:none';
  document.body.append(highlight);
  let selected = null;
  function mark(element) {
    const rect = element.getBoundingClientRect();
    Object.assign(highlight.style, { display:'block', left:rect.x+'px', top:rect.y+'px', width:rect.width+'px', height:rect.height+'px' });
  }
  document.addEventListener('pointermove', (event) => {
    if (selected) { mark(selected); return; }
    if (event.target instanceof Element && root.contains(event.target) && event.target !== root) mark(event.target);
    else highlight.style.display = 'none';
  });
  document.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    let element = event.target;
    if (!(element instanceof Element) || !root.contains(element) || element === root) return;
    selected = element;
    mark(selected);
    const path = [];
    while (element !== root) {
      path.unshift(element.localName + ':nth-child(' + (Array.from(element.parentElement.children).indexOf(element) + 1) + ')');
      element = element.parentElement;
    }
    const rect = selected.getBoundingClientRect();
    parent.postMessage({ type:'forma:element-selected', pageId:${JSON.stringify(pageId)}, selector:'.forma-page > ' + path.join(' > '), html:selected.outerHTML.slice(0,4000), text:(selected.textContent || selected.getAttribute('alt') || selected.localName).trim().slice(0,160), bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height} }, '*');
  }, true);
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'forma:selection') return;
    selected = event.data.selector ? root.querySelector(event.data.selector) : null;
    if (selected) mark(selected);
    else highlight.style.display = 'none';
  });
  document.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    const deltaY = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? window.innerHeight : 1);
    parent.postMessage({ type:'forma:page-wheel', pageId:${JSON.stringify(pageId)}, deltaY }, '*');
  }, { passive: true });
})();
</script>`;
}
