import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'http'

// ── Yogi Bridge Script (injected into every proxied page) ─────────────────────
// Runs inside the iframe. Intercepts navigation, reports DOM, executes commands.
const BRIDGE_SCRIPT = `<script id="yogi-bridge">
(function(){
  if(window.__yogiBridgeInstalled)return;window.__yogiBridgeInstalled=true;
  function sel(el){
    if(el.id)return'#'+el.id;
    var n=el.getAttribute('name');if(n)return el.tagName.toLowerCase()+'[name="'+n+'"]';
    var d=el.getAttribute('data-testid');if(d)return'[data-testid="'+d+'"]';
    var a=el.getAttribute('aria-label');if(a)return el.tagName.toLowerCase()+'[aria-label="'+a+'"]';
    if(el.placeholder)return el.tagName.toLowerCase()+'[placeholder="'+el.placeholder+'"]';
    return el.tagName.toLowerCase();
  }
  function reportDOM(){
    var nodes=Array.from(document.querySelectorAll('button,a[href],input,textarea,select,[role="button"],[role="link"],[role="menuitem"]'));
    var els=nodes.slice(0,60).map(function(el){
      return{tag:el.tagName.toLowerCase(),text:(el.innerText||el.value||'').trim().slice(0,40),selector:sel(el),placeholder:el.placeholder||'',ariaLabel:el.getAttribute('aria-label')||''};
    });
    try{window.parent.postMessage({type:'yogi-dom',elements:els,url:location.href},'*');}catch(e){}
  }
  // Intercept link clicks → route through proxy
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href]');
    if(a&&a.href&&!a.href.startsWith('javascript:')&&!a.target){
      e.preventDefault();e.stopPropagation();
      try{window.parent.postMessage({type:'yogi-navigate',url:a.href},'*');}catch(x){}
    }
  },true);
  // Listen for Yogi action commands from parent
  window.addEventListener('message',function(e){
    var d=e.data;if(!d||!d.type)return;
    var el;
    if(d.type==='yogi-click'){el=document.querySelector(d.selector);if(el){el.focus();el.click();setTimeout(reportDOM,1000);}}
    if(d.type==='yogi-type'){el=document.querySelector(d.selector);if(el){el.focus();el.value=d.value;['input','change'].forEach(function(ev){el.dispatchEvent(new Event(ev,{bubbles:true}));});var isSearch=(el.type==='search'||el.getAttribute('role')==='searchbox'||(el.getAttribute('aria-label')||'').toLowerCase().includes('search')||(el.placeholder||'').toLowerCase().includes('search')||d.selector.toLowerCase().includes('search'));if(isSearch){setTimeout(function(){el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));el.dispatchEvent(new KeyboardEvent('keypress',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));var form=el.closest('form');if(form)form.submit();setTimeout(reportDOM,1500);},400);}else{setTimeout(reportDOM,500);}}}
    if(d.type==='yogi-press-enter'){el=document.querySelector(d.selector)||document.activeElement;if(el){['keydown','keypress','keyup'].forEach(function(ev){el.dispatchEvent(new KeyboardEvent(ev,{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));});var form=el.closest('form');if(form)form.submit();setTimeout(reportDOM,1500);}}
    if(d.type==='yogi-dom-request'){reportDOM();}
    if(d.type==='yogi-screenshot-request'){
      if(!window.__html2canvasLoaded){
        var s=document.createElement('script');
        s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload=function(){window.__html2canvasLoaded=true;doCapture();};
        s.onerror=function(){
          try{window.parent.postMessage({type:'yogi-screenshot-result',status:'error',message:'Failed to load html2canvas'},'*');}catch(x){}
        };
        document.head.appendChild(s);
      }else{doCapture();}
      function doCapture(){
        html2canvas(document.body,{useCORS:true,allowTaint:true,scale:0.5,logging:false}).then(function(canvas){
          var data=canvas.toDataURL('image/png').split(',')[1];
          try{window.parent.postMessage({type:'yogi-screenshot-result',status:'success',image:data},'*');}catch(x){}
        }).catch(function(err){
          try{window.parent.postMessage({type:'yogi-screenshot-result',status:'error',message:err.message},'*');}catch(x){}
        });
      }
    }
  });
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',reportDOM);}
  else{setTimeout(reportDOM,600);}
  window.addEventListener('load',function(){setTimeout(reportDOM,1200);});
})();
</script>`

// ── Proxy middleware ──────────────────────────────────────────────────────────
const STRIP_HEADERS = new Set([
  'x-frame-options','content-security-policy','content-security-policy-report-only',
  'x-content-type-options','frame-options','cross-origin-opener-policy',
  'cross-origin-embedder-policy','cross-origin-resource-policy',
])

async function proxyMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
) {
  if (!req.url?.startsWith('/__proxy')) { next(); return }

  const targetUrl = new URL('http://x' + req.url).searchParams.get('url')
  if (!targetUrl) { res.writeHead(400); res.end('Missing ?url= parameter'); return }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    })

    const contentType = upstream.headers.get('content-type') || ''
    const outHeaders: Record<string, string> = { 'access-control-allow-origin': '*' }
    upstream.headers.forEach((v, k) => {
      if (!STRIP_HEADERS.has(k.toLowerCase())) outHeaders[k] = v
    })

    if (contentType.includes('text/html')) {
      let html = await upstream.text()

      // ── Strip page-level CSP so the bridge script can run ────────────
      // Google and other sites embed <meta http-equiv="Content-Security-Policy">
      // which blocks our injected inline script even after we strip the header.
      html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')
      html = html.replace(/<meta[^>]+http-equiv=["']X-Frame-Options["'][^>]*>/gi, '')

      // Inject <base> so relative resources load from origin, plus the bridge script
      const finalUrl = upstream.url || targetUrl
      const injection = `<base href="${finalUrl}">\n${BRIDGE_SCRIPT}`
      if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>\n' + injection)
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', '<HEAD>\n' + injection)
      } else {
        html = injection + html
      }

      // Override CSP header with a permissive policy so our inline bridge runs
      const permissiveHeaders = {
        ...outHeaders,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
      }
      res.writeHead(upstream.status, permissiveHeaders)
      res.end(html)
    } else {
      res.writeHead(upstream.status, outHeaders)
      const buf = await upstream.arrayBuffer()
      res.end(Buffer.from(buf))
    }
  } catch (err: any) {
    console.error('[YogiProxy]', err.message)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!DOCTYPE html><html><head><base href="/"><script id="yogi-bridge">
(function(){window.parent.postMessage({type:'yogi-dom',elements:[],url:'${targetUrl}'},'*');})();
</script></head>
<body style="background:#1a1a2e;color:#ff4466;font-family:monospace;padding:40px;text-align:center">
<h2 style="margin-bottom:16px">⚠️ Could not load page</h2>
<p style="color:#ccc;margin-bottom:8px">${err.message}</p>
<p style="color:#888;font-size:13px">Some sites block server-side fetching (Cloudflare, login walls).<br>
Try: google.com, wikipedia.org, news.ycombinator.com, or any open site.</p>
</body></html>`)
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'yogi-proxy',
      configureServer(server) {
        server.middlewares.use(proxyMiddleware as any)
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
  },
})
