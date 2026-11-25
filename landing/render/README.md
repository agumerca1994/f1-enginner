# Intro video

The landing's intro is a video rendered from a Three.js scene, so it plays smoothly on any
phone. `scene.js` builds the night corner; the cars are the downloaded single-seater in
`assets-src/monoplaza/` (kept out of git: its license does not allow redistributing the
model), loaded by `realcar.js` with the app's own paint. `car3d.js` is the older car built in code. Every
frame is a function of time, so frames rendered at 960 fps are blended into real motion blur.

Render from a folder that holds only the render files and the model, never the repo root
(it has the deploy secrets):

```sh
R=$(mktemp -d) && cp landing/render/{scene.js,realcar.js,intro.html,car3d.js} $R && mkdir $R/model \
  && cp assets-src/monoplaza/custom_f122.obj $R/model/ && python3 -m http.server 8090 --directory $R
npm i playwright-core                                 # once, anywhere on the NODE_PATH
node render/capture.cjs /tmp/h 1920 1080 960 5.6      # landscape frames
node render/capture.cjs /tmp/v 1080 1920 960 5.6      # portrait frames
for o in h v; do
  ffmpeg -framerate 960 -i /tmp/$o/f%05d.jpg -vf "tmix=frames=16,framestep=16,format=yuv420p" \
    -r 60 -c:v libx264 -preset slow -crf 23 -movflags +faststart -an assets/intro/intro-$o.mp4
  ffmpeg -i /tmp/$o/f00000.jpg -vf scale=iw/2:-1 assets/intro/poster-$o.jpg
done
```

`render/carlab.html?c=x,y,z` shows the car alone from a camera position, for modelling.
This folder is not copied into the nginx image.
