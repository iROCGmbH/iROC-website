const http = require('http');
const basePath = (process.env.BASE_PATH || '/spirecut-mobile/')
  .replace(/\/+$/, '') || '/';
const canonicalWebPath = (process.env.SPIRECUT_WEB_PATH || '/spirecut-patient/')
  .replace(/\/+$/, '') || '/';

const routeMap = {
  '/': '/',
  '/karpaltunnel': '/karpaltunnelsyndrom',
  '/schnappfinger': '/schnappfinger',
  '/faq': '/faq',
  '/arzt': '/arzt-finden',
  '/how-it-works': '/so-funktioniert-es',
  '/postop': '/postoperative-entwicklung',
};

function withoutBasePath(pathname) {
  if (basePath === '/' || !pathname.startsWith(basePath)) return pathname;
  return pathname.slice(basePath.length) || '/';
}

function webLocation(route, search) {
  const normalisedRoute = route.replace(/\/+$/, '') || '/';
  const mappedRoute = routeMap[normalisedRoute] || '/';
  const root = canonicalWebPath === '/' ? '' : canonicalWebPath;
  return `${root}${mappedRoute}${search}`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const route = withoutBasePath(url.pathname);

  if (route === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'redirecting-to-spirecut-patient' }));
    return;
  }

  res.writeHead(308, {
    location: webLocation(route, url.search),
    'cache-control': 'no-store',
  });
  res.end();
});

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, '0.0.0.0', () => {
  console.log(`Redirecting legacy Spirecut mobile links on port ${port}`);
});
