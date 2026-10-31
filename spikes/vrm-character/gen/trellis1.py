import time, shutil
from gradio_client import Client, handle_file
c = Client('trellis-community/TRELLIS'); t=time.time()
c.predict(api_name='/start_session')
img = c.predict(handle_file('/workspace/gen-apose.jpg'), api_name='/preprocess_image'); print('pre', img)
r = c.predict(handle_file(img), [], 0, 7.5, 12, 3.0, 12, 'stochastic', 0.9, 2048, api_name='/generate_and_extract_glb')
print('done', time.time()-t, r)
shutil.copy(r[1], '/workspace/gen3d/trellis1.glb'); print('saved')
