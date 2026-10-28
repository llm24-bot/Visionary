import http.server, os, functools
ROOT='/home/user/workspace/visionary'
import json
HDRS=[(h['key'],h['value'].replace('; upgrade-insecure-requests','')) for h in json.load(open(ROOT+'/vercel.json'))['headers'][0]['headers'] if h['key']!='Strict-Transport-Security']
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        for k,v in HDRS: self.send_header(k,v)
        super().end_headers()
    def send_head(self):
        path=self.translate_path(self.path.split('?')[0])
        if not os.path.exists(path) and os.path.exists(path+'.html'):
            self.path=self.path.split('?')[0]+'.html'
        elif not os.path.exists(path):
            self.send_response(404); self.send_header('Content-Type','text/html'); b=open(ROOT+'/404.html','rb').read()
            self.send_header('Content-Length',str(len(b))); self.end_headers(); return __import__('io').BytesIO(b)
        return super().send_head()
    def log_message(self,*a): pass
http.server.ThreadingHTTPServer(('127.0.0.1',8000),functools.partial(H,directory=ROOT)).serve_forever()
