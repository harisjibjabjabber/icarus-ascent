import time, shutil, sys
from gradio_client import Client, handle_file
c = Client('microsoft/TRELLIS.2')
t=time.time()
c.predict(api_name='/start_session')
img = c.predict(handle_file('/workspace/gen-apose.jpg'), api_name='/preprocess_image')
print('pre', img, time.time()-t)
r = c.predict(handle_file(img), 0, '1024', api_name='/image_to_3d')
print('gen done', time.time()-t, str(r)[:200])
g = c.predict(60000, 2048, api_name='/extract_glb')
print('glb', g, time.time()-t)
p = g[0] if isinstance(g,(list,tuple)) else g
shutil.copy(p, '/workspace/gen3d/trellis2.glb'); print('saved')
